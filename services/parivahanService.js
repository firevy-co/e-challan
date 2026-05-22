const startBrowser = require("../utils/browser");
const cheerio = require("cheerio");
const { v4: uuidv4 } = require("uuid");

// Global session store to keep Puppeteer pages alive between OTP requests
const sessions = new Map();

/*
|--------------------------------------------------------------------------
| STEP 1: Request OTP
|--------------------------------------------------------------------------
*/
const requestVehicleOtp = async (vehicleNumber, mobileNumber) => {
    let browser = null;
    let page = null;

    try {
        browser = await startBrowser();
        page = await browser.newPage();

        const targetUrl = `https://vehicleinfo.app/challan-details/${vehicleNumber}?rc_no=${vehicleNumber}`;
        
        await page.goto(targetUrl, {
            waitUntil: "networkidle2",
            timeout: 60000
        });

        // Check if there's a login button (if there isn't, maybe no challans exist or it's free)
        const loginBtnSelector = '.cdl-more button';
        const loginBtnExists = await page.$(loginBtnSelector).catch(() => null);
        
        if (loginBtnExists) {
            // Use DOM click to bypass any overlay ads that might block native Puppeteer clicks
            await page.evaluate(b => b.click(), loginBtnExists);
            
            // Wait for modal and phone input
            await page.waitForSelector('input[type="tel"]', { timeout: 10000, visible: true });
            
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
            await page.close();
            return {
                success: false,
                message: "No login required or no challans found for this vehicle. Try fetching directly."
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
        const html = await page.content();
        const $ = cheerio.load(html);

        const details = [];

        $('.cdl-items-card').each((i, el) => {
            // Uncensored challan number should now be visible in .cdl-no (remove fallback to .cdl-blur which causes ####)
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

        // Cleanup session
        sessions.delete(sessionId);
        await page.close().catch(() => {});

        return {
            success: true,
            vehicleNumber,
            totalChallans: details.length,
            details
        };

    } catch (error) {
        sessions.delete(sessionId);
        if (page) await page.close().catch(() => {});
        console.error("OTP Verification error:", error);
        throw error;
    }
};

// Cleanup old sessions periodically (every 10 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (now - session.createdAt > 10 * 60 * 1000) { // 10 minutes expiry
            session.page.close().catch(() => {});
            sessions.delete(id);
        }
    }
}, 60000);

module.exports = {
    requestVehicleOtp,
    verifyVehicleOtpAndFetch
};