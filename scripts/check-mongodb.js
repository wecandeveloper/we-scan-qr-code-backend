/**
 * Verifies MongoDB connectivity using the same env vars as the app.
 * Usage: npm run check:mongodb
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');

function getMongoUri() {
    return (
        process.env.MONGODB_CLOUD_URI ||
        process.env.MONGODB_URI ||
        process.env.DB_URI
    );
}

async function main() {
    const mongoUri = getMongoUri();
    if (!mongoUri || typeof mongoUri !== 'string' || mongoUri.trim() === '') {
        console.error(
            'Missing MongoDB URI. Set one of MONGODB_CLOUD_URI, MONGODB_URI, or DB_URI in .env.'
        );
        process.exit(1);
    }

    const options = {};
    if (process.env.NODE_ENV !== 'production') {
        options.serverSelectionTimeoutMS = 10000;
    }

    try {
        await mongoose.connect(mongoUri.trim(), options);
        await mongoose.connection.db.admin().command({ ping: 1 });
        const dbName = mongoose.connection.name;
        console.log(`MongoDB connection OK (database: ${dbName}).`);
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error('MongoDB connection failed:', err.message);
        try {
            await mongoose.disconnect();
        } catch {
            // ignore
        }
        process.exit(1);
    }
}

main();
