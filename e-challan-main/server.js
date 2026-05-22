require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const challanRoutes = require("./routes/challanRoutes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, 'public')));

app.use("/api", challanRoutes);

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Challan Backend Running"
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});