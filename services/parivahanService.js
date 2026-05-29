const startBrowser = require("../utils/browser");
const cheerio = require("cheerio");
const { v4: uuidv4 } = require("uuid");
const { getVehicleRecord, saveVehicleRecord } = require("../utils/persistentDb");

// Global session store to keep Puppeteer pages alive between OTP requests
const sessions = new Map();

// Cache to store successfully fetched challan results for 5 minutes
const challanCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

/*
|--------------------------------------------------------------------------
| STEP 1: Request OTP
|--------------------------------------------------------------------------
*/
const requestVehicleOtp = async (vehicleNumber, mobileNumber) => {
    // 0. Check persistent limit first
    const record = getVehicleRecord(vehicleNumber);
    if (record && record.count >= 3) {
        console.log(`[Limit Reached] Returning permanently cached challan details for vehicle: ${vehicleNumber}`);
        return {
            success: true,
            fromCache: true,
            data: record.lastData
        };
    }

    // 1. Check if we have cached challan details for this vehicle
    const cached = challanCache.get(vehicleNumber);
    if (cached && (Date.now() - cached.createdAt < CACHE_TTL)) {
        console.log(`[Cache Hit] Returning cached challan details for vehicle: ${vehicleNumber}`);
        return {
            success: true,
            fromCache: true,
            data: cached.data
        };
    }

    // 2. Clean up any existing duplicate session for the same vehicle
    for (const [id, session] of sessions.entries()) {
        if (session.vehicleNumber === vehicleNumber) {
            console.log(`[Session Cleanup] Closing previous duplicate page/session for vehicle: ${vehicleNumber}`);
            await session.page.close().catch(() => {});
            sessions.delete(id);
        }
    }

    let browser = null;
    let page = null;

    try {
        browser = await startBrowser();
        page = await browser.newPage();

        // 3. Enable request interception to block images, fonts, media, and ads/trackers
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            const url = req.url().toLowerCase();

            const shouldBlock = 
                ['image', 'font', 'media'].includes(resourceType) ||
                url.includes('google-analytics') || 
                url.includes('doubleclick') || 
                url.includes('facebook') || 
                url.includes('googleadservices') || 
                url.includes('googlesyndication') || 
                url.includes('adservice') ||
                url.includes('coinhive') ||
                url.includes('track');

            if (shouldBlock) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const targetUrl = `https://vehicleinfo.app/challan-details/${vehicleNumber}?rc_no=${vehicleNumber}`;
        
        await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        let loginBtnExists = null;
        try {
            await page.waitForFunction(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                return btns.some(b => b.innerText && b.innerText.toUpperCase().includes('LOGIN TO CONTINUE')) || document.querySelector('.cdl-items-card');
            }, { timeout: 15000 });
            
            loginBtnExists = await page.evaluateHandle(() => {
                return Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.toUpperCase().includes('LOGIN TO CONTINUE'));
            });
            
            const isUndefined = await loginBtnExists.evaluate(b => b === undefined);
            if (isUndefined) loginBtnExists = null;
        } catch (e) {
            console.log("Timeout waiting for login button or challan list");
        }
        
        if (loginBtnExists) {
            // Wait a brief moment to ensure React is fully hydrated and event handlers are attached
            await new Promise(r => setTimeout(r, 1500));

            // Use DOM click to bypass any overlay ads that might block native Puppeteer clicks
            await loginBtnExists.evaluate(b => b.click());
            
            // Wait for modal and phone input to appear in the DOM (visible: true is omitted to avoid CSS transition animation race conditions)
            await page.waitForSelector('input[type="tel"]', { timeout: 15000 });
            
            // Wait a moment for transition animations to finish and inputs to be ready
            await new Promise(r => setTimeout(r, 500));
            
            // Type mobile number
            await page.type('input[type="tel"]', mobileNumber);
            
            // Wait a moment for validation or auto-submit
            await new Promise(r => setTimeout(r, 1000));
            
            // Click Submit/Get OTP (wrap in try-catch because many React forms auto-submit when 10 digits are typed)
            try {
                const btn = await page.$('button[type="submit"]');
                if (btn) {
                    await page.evaluate(b => b.click(), btn);
                }
            } catch (e) {
                console.log("Submit button click failed, likely auto-submitted:", e.message);
            }
            
            // Wait for OTP input to appear (usually the phone input disappears or new inputs appear)
            // We wait 2 seconds for the network request to finish and DOM to update
            await new Promise(r => setTimeout(r, 2000));
            
            // Generate session ID
            const sessionId = uuidv4();
            
            // Save the active page and browser to the session map
            sessions.set(sessionId, {
                browser,
                page,
                vehicleNumber,
                createdAt: Date.now()
            });

            return {
                success: true,
                message: "OTP sent successfully",
                sessionId
            };
        } else {
            // No login button means we can just scrape directly or no challans exist
            // Let's close the browser since we don't need to wait for OTP
            
            console.log("No login button found. Attempting to fetch challans directly...");
            const details = await extractChallanData(page, vehicleNumber);
            
            await page.close();
            
            // Save successfully fetched data to cache
            const resultData = {
                vehicleNumber,
                totalChallans: details.length,
                details
            };
            
            // Save to persistent database
            saveVehicleRecord(vehicleNumber, resultData);

            challanCache.set(vehicleNumber, {
                data: resultData,
                createdAt: Date.now()
            });

            return {
                success: true,
                fromCache: true,
                data: resultData
            };
        }

    } catch (error) {
        if (page) await page.close().catch(() => {});
        console.error("OTP Request error:", error);
        throw error;
    }
};

/*
|--------------------------------------------------------------------------
| STEP 2: Verify OTP and Fetch Challans
|--------------------------------------------------------------------------
*/
const verifyVehicleOtpAndFetch = async (sessionId, otp) => {
    const session = sessions.get(sessionId);

    if (!session) {
        throw new Error("Invalid or expired session. Please request a new OTP.");
    }

    const { page, browser, vehicleNumber } = session;

    try {
        // Find OTP inputs. Usually they are visible inputs that are NOT the disabled phone input
        // Or we can just use keyboard typing if focus is auto-set
        // Try typing directly first. We MUST add a delay because React OTP 
        // components need time to shift focus to the next input box after each digit!
        await page.keyboard.type(otp, { delay: 150 });
        
        // Wait a bit to see if it auto-submits, if not, click the submit button
        await new Promise(r => setTimeout(r, 1000));
        
        // Find and click the verify button (usually type=submit)
        const submitBtnExists = await page.$('button[type="submit"]').catch(() => null);
        if (submitBtnExists) {
            await page.click('button[type="submit"]').catch(() => {});
        }

        // Wait for modal to disappear and authentication to complete
        await new Promise(r => setTimeout(r, 4000));
        
        // Take a screenshot to debug if the OTP was actually accepted
        await page.screenshot({ path: 'debug_after_otp_submit.png' });

        // IMPORTANT: VehicleInfo shows a "Success! Got it" popup. 
        // We must click "Got it" to close the modal and apply the session.
        console.log("Clicking 'Got it' on the success modal...");
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button, a, div'));
            const gotItBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'got it');
            if (gotItBtn) gotItBtn.click();
        });

        // Wait for modal to close
        await new Promise(r => setTimeout(r, 2000));

        // RELOAD THE PAGE: This ensures the DOM renders the newly authenticated state!
        console.log("Reloading page with authenticated session...");
        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
        
        // Take another screenshot to see what the authenticated page looks like
        await page.screenshot({ path: 'debug_after_reload.png' });

        // Now we scrape the uncensored data
        const details = await extractChallanData(page, vehicleNumber);

        // Cleanup session
        sessions.delete(sessionId);
        await page.close().catch(() => {});

        // Save successfully fetched data to cache
        const resultData = {
            vehicleNumber,
            totalChallans: details.length,
            details
        };

        // Save to persistent database
        saveVehicleRecord(vehicleNumber, resultData);

        challanCache.set(vehicleNumber, {
            data: resultData,
            createdAt: Date.now()
        });

        return {
            success: true,
            ...resultData
        };

    } catch (error) {
        sessions.delete(sessionId);
        if (page) await page.close().catch(() => {});
        console.error("OTP Verification error:", error);
        throw error;
    }
};

// Cleanup old sessions and expired cache entries periodically (every 1 minute)
setInterval(() => {
    const now = Date.now();
    
    // Cleanup sessions older than 3 minutes
    for (const [id, session] of sessions.entries()) {
        if (now - session.createdAt > 3 * 60 * 1000) { // 3 minutes expiry
            console.log(`[Session Expiry] Closing expired page for session: ${id}`);
            session.page.close().catch(() => {});
            sessions.delete(id);
        }
    }

    // Cleanup expired cache entries
    for (const [key, value] of challanCache.entries()) {
        // Cache expires after 5 minutes
        if (now - value.createdAt > 5 * 60 * 1000) {
            challanCache.delete(key);
        }
    }
}, 60000);

// Helper function to extract challan data from the page using Cheerio
async function extractChallanData(page, vehicleNumber) {
    const html = await page.content();
    const $ = cheerio.load(html);

    const details = [];

    $('.cdl-items-card').each((i, el) => {
        const challanText = $(el).find('.cdl-no').text().replace('Challan', '').trim();
        const challanBlurText = $(el).find('.cdl-blur').text().trim();
        const challanNo = challanText || challanBlurText;
        
        const date = $(el).find('.cdl-date').text().replace('Issued Date', '').trim();
        const offence = $(el).find('.cdl-Offence').text().replace('Offence:', '').trim();
        const amount = $(el).find('.cdl-amount p').text().trim();
        const status = $(el).closest('.cdl-items').find('.cdl-header-content-text h6').text().trim() || "Pending";

        details.push({
            challanNumber: challanNo,
            date: date,
            offence: offence,
            amount: amount,
            status: status
        });
    });

    return details;
}

module.exports = {
    requestVehicleOtp,
    verifyVehicleOtpAndFetch
};