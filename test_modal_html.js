const startBrowser = require("./utils/browser");

(async () => {
    try {
        const browser = await startBrowser();
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1280, height: 800 });
        const testUrl = "https://vehicleinfo.app/challan-details/GJ05CH2906?rc_no=GJ05CH2906";
        console.log("Navigating to:", testUrl);
        await page.goto(testUrl, { waitUntil: 'networkidle2' });
        
        console.log("Waiting for Login button...");
        await page.waitForSelector('.cdl-more button', { timeout: 10000 });
        
        console.log("Clicking Login button...");
        await page.click('.cdl-more button');
        
        console.log("Waiting for modal to open...");
        await page.waitForSelector('.modal-dialog, [role="dialog"], input[type="tel"]', { timeout: 10000 });
        
        console.log("Waiting an extra 2 seconds for animation...");
        await new Promise(r => setTimeout(r, 2000));
        
        const html = await page.content();
        require('fs').writeFileSync('vehicleinfo_modal.html', html);
        console.log("Dumped HTML.");
        
        await browser.close();
    } catch (e) {
        console.error("Error:", e);
    }
})();
