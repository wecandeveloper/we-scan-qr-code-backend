const mongoose = require('mongoose');

const configureDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_CLOUD_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log("✅ MongoDB Connected...");
    } catch (err) {
        console.error("❌ Error Connecting to MongoDB:", err.message);
        process.exit(1); // Stop server on failure
    }
};

module.exports = configureDB;