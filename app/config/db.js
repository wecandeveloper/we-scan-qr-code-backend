const mongoose = require('mongoose');

function getMongoUri() {
    return (
        process.env.MONGODB_CLOUD_URI ||
        process.env.MONGODB_URI ||
        process.env.DB_URI
    );
}

const configureDB = async () => {
    const mongoUri = getMongoUri();
    if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim() === '') {
        console.error(
            '❌ Missing MongoDB URI. Set one of MONGODB_CLOUD_URI, MONGODB_URI, or DB_URI.'
        );
        process.exit(1);
    }

    const options = {};
    if (process.env.NODE_ENV !== 'production') {
        options.serverSelectionTimeoutMS = 10000;
    }

    try {
        await mongoose.connect(mongoUri.trim(), options);
        console.log('✅ MongoDB Connected...');
    } catch (err) {
        console.error('❌ Error Connecting to MongoDB:', err.message);
        process.exit(1);
    }
};

module.exports = configureDB;
