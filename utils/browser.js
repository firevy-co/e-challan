const path = require("path");
const fs = require("fs");
const os = require("os");

let browser;

const isWindows = os.platform() === "win32";

/**
 * Find a working Chrome executable by checking common locations.
 * Works on both Windows (local dev) and Linux (Docker/Render deployment).
 */
const findChromeExecutable = async (puppeteer) => {
    // 1. Check environment variable first (highest priority)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        
        // Fix for Render: If we are on Linux but the env variable is a Windows path (C:\...)
        // ignore it. This happens if the user copied their local .env to Render's dashboard.
        if (!isWindows && envPath.match(/^[a-zA-Z]:\\/)) {
            console.warn(`[Browser] WARNING: Ignoring Windows PUPPETEER_EXECUTABLE_PATH on Linux: ${envPath}`);
            delete process.env.PUPPETEER_EXECUTABLE_PATH; // Delete so puppeteer doesn't use it either
        } else if (fs.existsSync(envPath)) {
            console.log(`[Browser] Using Chrome from PUPPETEER_EXECUTABLE_PATH: ${envPath}`);
            return envPath;
        } else {
            console.warn(`[Browser] WARNING: PUPPETEER_EXECUTABLE_PATH is set but file not found: ${envPath}`);
            delete process.env.PUPPETEER_EXECUTABLE_PATH; // Delete so we fallback properly
        }
    }

    // 2. Try Puppeteer's built-in executable path resolution
    try {
        const defaultPath = await puppeteer.executablePath();
        if (fs.existsSync(defaultPath)) {
            console.log(`[Browser] Using Chrome from Puppeteer default: ${defaultPath}`);
            return defaultPath;
        }
        console.warn(`[Browser] Puppeteer default path does not exist: ${defaultPath}`);
    } catch (e) {
        console.warn(`[Browser] Could not resolve Puppeteer default path: ${e.message}`);
    }

    // 3. Check common system-installed Chrome paths (Linux for Docker/Render)
    if (!isWindows) {
        const linuxPaths = [
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/snap/bin/chromium",
        ];
        for (const p of linuxPaths) {
            if (fs.existsSync(p)) {
                console.log(`[Browser] Found Chrome at system path: ${p}`);
                return p;
            }
        }
    }

    // 4. Fallback: scan global Puppeteer cache
    const homeDir = isWindows ? process.env.USERPROFILE : process.env.HOME;
    const globalCacheDir = path.join(homeDir || "", ".cache", "puppeteer", "chrome");
    const platformPrefix = isWindows ? "win64-" : "linux-";
    const binaryName = isWindows ? "chrome.exe" : "chrome";
    const platformDir = isWindows ? "chrome-win64" : "chrome-linux64";

    if (fs.existsSync(globalCacheDir)) {
        const versions = fs.readdirSync(globalCacheDir)
            .filter(d => d.startsWith(platformPrefix))
            .sort()
            .reverse(); // newest first

        for (const version of versions) {
            const candidatePath = path.join(globalCacheDir, version, platformDir, binaryName);
            if (fs.existsSync(candidatePath)) {
                console.log(`[Browser] Found Chrome in global cache: ${candidatePath}`);
                return candidatePath;
            }
        }
    }

    // 5. Fallback: scan project-local .cache
    const localCacheDir = path.join(__dirname, "..", ".cache", "puppeteer", "chrome");
    if (fs.existsSync(localCacheDir)) {
        const versions = fs.readdirSync(localCacheDir)
            .filter(d => d.startsWith(platformPrefix))
            .sort()
            .reverse();

        for (const version of versions) {
            const candidatePath = path.join(localCacheDir, version, platformDir, binaryName);
            if (fs.existsSync(candidatePath)) {
                console.log(`[Browser] Found Chrome in local cache: ${candidatePath}`);
                return candidatePath;
            }
        }
    }

    throw new Error(
        "Chrome executable not found! Please run: npx puppeteer browsers install chrome\n" +
        "Or set PUPPETEER_EXECUTABLE_PATH in your .env file to point to a valid Chrome binary"
    );
};

const startBrowser = async () => {
    if (!browser || !browser.connected) {
        // Reset browser reference if it was disconnected
        browser = null;

        const puppeteer = (await import("puppeteer")).default;
        const execPath = await findChromeExecutable(puppeteer);

        browser = await puppeteer.launch({
            headless: true,
            executablePath: execPath,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--single-process",
            ]
        });

        // Handle unexpected disconnections
        browser.on("disconnected", () => {
            console.log("[Browser] Browser disconnected, will restart on next request");
            browser = null;
        });

        console.log(`[Browser] Chrome launched successfully from: ${execPath}`);
    }

    return browser;
};

module.exports = startBrowser;
