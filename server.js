require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const os = require("os");
const path = require("path");

const challanRoutes = require("./routes/challanRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Disable caching for all backend responses
app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
});

app.use("/api", challanRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Challan Backend Running"
    });
});

// Debug endpoint to diagnose Chrome/Puppeteer issues on deployment
app.get("/debug", async (req, res) => {
    const chromePaths = [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
    ];

    const chromeStatus = {};
    for (const p of chromePaths) {
        chromeStatus[p] = fs.existsSync(p);
    }

    const homeDir = process.env.HOME || "";
    const globalCacheDir = path.join(homeDir, ".cache", "puppeteer", "chrome");
    let cacheContents = [];
    if (fs.existsSync(globalCacheDir)) {
        cacheContents = fs.readdirSync(globalCacheDir);
    }

    const localCacheDir = path.join(__dirname, "..", ".cache", "puppeteer", "chrome");
    let localCacheContents = [];
    if (fs.existsSync(localCacheDir)) {
        localCacheContents = fs.readdirSync(localCacheDir);
    }

    let puppeteerDefaultPath = "UNKNOWN";
    try {
        const puppeteer = (await import("puppeteer")).default;
        puppeteerDefaultPath = await puppeteer.executablePath();
    } catch (e) {
        puppeteerDefaultPath = e.message;
    }

    res.json({
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        env: {
            PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH,
            PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD,
            RENDER: process.env.RENDER
        },
        puppeteerDefaultPath,
        puppeteerDefaultExists: fs.existsSync(puppeteerDefaultPath),
        chromePaths: chromeStatus,
        HOME: homeDir,
        globalCacheDir,
        cacheContents,
        localCacheDir,
        localCacheContents
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
