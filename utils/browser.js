let browser;

const startBrowser = async () => {
    if (!browser) {
        const puppeteer = (await import("puppeteer")).default;
        browser = await puppeteer.launch({
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
        });
    }

    return browser;
};

module.exports = startBrowser;