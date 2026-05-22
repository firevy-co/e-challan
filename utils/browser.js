const puppeteer = require("puppeteer");

let browser;

const startBrowser = async () => {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
    }

    return browser;
};

module.exports = startBrowser;