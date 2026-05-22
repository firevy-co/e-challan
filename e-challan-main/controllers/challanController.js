const { requestVehicleOtp, verifyVehicleOtpAndFetch } = require("../services/parivahanService");

const requestOtp = async (req, res) => {
    try {
        const { vehicleNumber, mobileNumber } = req.body;

        if (!vehicleNumber || !mobileNumber) {
            return res.status(400).json({
                success: false,
                message: "vehicleNumber and mobileNumber are required"
            });
        }

        const sanitizedVehicleNumber = vehicleNumber.replace(/[\s-]/g, '').toUpperCase();
        
        const data = await requestVehicleOtp(sanitizedVehicleNumber, mobileNumber);

        return res.status(200).json(data);
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const verifyOtp = async (req, res) => {
    try {
        const { sessionId, otp } = req.body;

        if (!sessionId || !otp) {
            return res.status(400).json({
                success: false,
                message: "sessionId and otp are required"
            });
        }

        const data = await verifyVehicleOtpAndFetch(sessionId, otp);

        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    requestOtp,
    verifyOtp
};