const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'database.json');

// Ensure DB file exists
function initDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({}), 'utf-8');
    }
}

function readDB() {
    try {
        initDB();
        const data = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Error reading database.json:", error);
        return {};
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error("Error writing to database.json:", error);
    }
}

const getVehicleRecord = (vehicleNumber) => {
    const db = readDB();
    const record = db[vehicleNumber];
    
    if (record) {
        // If there's an updatedAt timestamp, check if it's older than 24 hours
        if (record.updatedAt) {
            const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
            if (Date.now() - record.updatedAt > TWENTY_FOUR_HOURS) {
                // Expired: remove it from DB and return null
                delete db[vehicleNumber];
                writeDB(db);
                return null;
            }
        }
        return record;
    }
    
    return null;
};

const saveVehicleRecord = (vehicleNumber, data) => {
    const db = readDB();
    
    if (!db[vehicleNumber]) {
        db[vehicleNumber] = {
            count: 1,
            lastData: data,
            updatedAt: Date.now()
        };
    } else {
        db[vehicleNumber].count += 1;
        db[vehicleNumber].lastData = data;
        db[vehicleNumber].updatedAt = Date.now();
    }

    writeDB(db);
};

// Cleanup old records periodically (every 1 hour)
setInterval(() => {
    const db = readDB();
    let modified = false;
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    
    for (const [vehicleNumber, record] of Object.entries(db)) {
        if (record.updatedAt && (now - record.updatedAt > TWENTY_FOUR_HOURS)) {
            delete db[vehicleNumber];
            modified = true;
        }
    }
    
    if (modified) {
        writeDB(db);
    }
}, 60 * 60 * 1000);

module.exports = {
    getVehicleRecord,
    saveVehicleRecord
};
