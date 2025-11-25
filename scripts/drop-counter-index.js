/**
 * Script to drop the unique index on restaurantId from the 'counters' collection
 * 
 * This is safe to run because:
 * 1. Our Counter model now uses 'orderCounters' collection (not 'counters')
 * 2. mongoose-sequence plugin uses 'counters' collection but doesn't need restaurantId
 * 3. The index was created by the old Counter model which is no longer using 'counters'
 * 
 * Run this script once to fix the duplicate key error:
 * node scripts/drop-counter-index.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function dropCounterIndex() {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || process.env.DB_URI);
        console.log('Connected to MongoDB');

        const db = mongoose.connection.db;
        const countersCollection = db.collection('counters');

        // List all indexes
        const indexes = await countersCollection.indexes();
        console.log('Current indexes on counters collection:', indexes);

        // Check if restaurantId_1 index exists
        const restaurantIdIndex = indexes.find(idx => idx.name === 'restaurantId_1');
        
        if (restaurantIdIndex) {
            console.log('Found restaurantId_1 index. Dropping it...');
            await countersCollection.dropIndex('restaurantId_1');
            console.log('✅ Successfully dropped restaurantId_1 index');
        } else {
            console.log('ℹ️  restaurantId_1 index not found. It may have already been dropped.');
        }

        // List indexes again to confirm
        const indexesAfter = await countersCollection.indexes();
        console.log('Indexes after operation:', indexesAfter);

        await mongoose.connection.close();
        console.log('✅ Done! Connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

dropCounterIndex();

