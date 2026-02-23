/**
 * Phase 1: Cloudinary to S3 Migration - Asset Audit / Backup Script
 *
 * READ-ONLY script. Scans all collections that store image URLs and produces
 * a backup JSON file. NO database writes - only reads from MongoDB.
 *
 * Output format - entries categorized by collection name:
 *   { summary, User: [...], Restaurant: [...], Product: [...], Category: [...] }
 *   Each entry: { objectId, field, value }
 *
 * Run: node scripts/audit-cloudinary-assets.js
 *
 * Output: audit-cloudinary-assets.json (project root)
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(rootDir, '.env') });
require('dotenv').config({ path: path.join(rootDir, '.env.local') });

const CLOUDINARY_DOMAIN = 'cloudinary.com';

function isCloudinaryUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    return value.includes(CLOUDINARY_DOMAIN);
}

function createEntry(collection, objectId, field, value) {
    return { collection, objectId, field, value };
}

function collectCloudinaryFromArray(arr, basePath, docId, collection, entries) {
    if (!Array.isArray(arr)) return;
    arr.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        if (item.url && isCloudinaryUrl(item.url)) {
            const field = `${basePath}[${index}]`;
            const value = {
                url: item.url,
                publicId: item.publicId || null,
                hash: item.hash || null,
            };
            entries.push(createEntry(collection, docId, field, value));
        }
    });
}

function collectCloudinaryFromObject(obj, basePath, docId, collection, entries) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.url && isCloudinaryUrl(obj.url)) {
        const value = {
            url: obj.url,
            publicId: obj.publicId || null,
            hash: obj.hash || null,
        };
        entries.push(createEntry(collection, docId, basePath, value));
    }
}

async function auditUser(db, entries) {
    const users = await db.collection('users').find({}).toArray();
    for (const doc of users) {
        if (doc.profilePic && isCloudinaryUrl(doc.profilePic)) {
            const value = {
                url: doc.profilePic,
                publicId: doc.profilePicPublicId || null,
                hash: doc.profilePicHash || null,
            };
            entries.push(createEntry('User', doc._id.toString(), 'profilePic', value));
        }
    }
}

async function auditRestaurant(db, entries) {
    const restaurants = await db.collection('restaurants').find({}).toArray();
    for (const doc of restaurants) {
        const docId = doc._id.toString();

        if (doc.qrCodeURL && isCloudinaryUrl(doc.qrCodeURL)) {
            entries.push(createEntry('Restaurant', docId, 'qrCodeURL', doc.qrCodeURL));
        }

        collectCloudinaryFromArray(doc.images, 'images', docId, 'Restaurant', entries);

        if (doc.theme) {
            collectCloudinaryFromObject(
                doc.theme.logo,
                'theme.logo',
                docId,
                'Restaurant',
                entries
            );
            collectCloudinaryFromObject(
                doc.theme.favIcon,
                'theme.favIcon',
                docId,
                'Restaurant',
                entries
            );
            collectCloudinaryFromArray(
                doc.theme.bannerImages,
                'theme.bannerImages',
                docId,
                'Restaurant',
                entries
            );
            collectCloudinaryFromArray(
                doc.theme.offerBannerImages,
                'theme.offerBannerImages',
                docId,
                'Restaurant',
                entries
            );
        }
    }
}

async function auditProduct(db, entries) {
    const products = await db.collection('products').find({}).toArray();
    for (const doc of products) {
        collectCloudinaryFromArray(
            doc.images,
            'images',
            doc._id.toString(),
            'Product',
            entries
        );
    }
}

async function auditCategory(db, entries) {
    const categories = await db.collection('categories').find({}).toArray();
    for (const doc of categories) {
        if (doc.image && isCloudinaryUrl(doc.image)) {
            const value = {
                url: doc.image,
                publicId: doc.imagePublicId || null,
                hash: doc.imageHash || null,
            };
            entries.push(createEntry('Category', doc._id.toString(), 'image', value));
        }
    }
}

async function runAudit() {
    const entries = [];

    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_CLOUD_URI || process.env.DB_URI;
        if (!mongoUri) {
            console.error('MongoDB URI not set. Set MONGODB_URI or MONGODB_CLOUD_URI in .env');
            process.exit(1);
        }
        await mongoose.connect(mongoUri);
        const db = mongoose.connection.db;
        console.log('Connected to MongoDB (read-only)', '- DB:', db.databaseName);

        console.log('Scanning User collection...');
        await auditUser(db, entries);

        console.log('Scanning Restaurant collection...');
        await auditRestaurant(db, entries);

        console.log('Scanning Product collection...');
        await auditProduct(db, entries);

        console.log('Scanning Category collection...');
        await auditCategory(db, entries);

        const COLLECTIONS = ['User', 'Restaurant', 'Product', 'Category'];
        const byCollection = COLLECTIONS.reduce((acc, name) => {
            acc[name] = [];
            return acc;
        }, {});

        entries.forEach((e) => {
            const { collection, objectId, field, value } = e;
            byCollection[collection].push({ objectId, field, value });
        });

        const report = {
            summary: {
                totalEntries: entries.length,
                byCollection: COLLECTIONS.reduce((acc, name) => {
                    acc[name] = byCollection[name].length;
                    return acc;
                }, {}),
                generatedAt: new Date().toISOString(),
            },
            User: byCollection.User,
            Restaurant: byCollection.Restaurant,
            Product: byCollection.Product,
            Category: byCollection.Category,
        };

        const outputDir = path.join(__dirname, '..');
        const outputPath = path.join(outputDir, 'audit-cloudinary-assets.json');
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');

        console.log('\n--- Audit Complete (No DB writes performed) ---');
        console.log(`Total Cloudinary entries: ${report.summary.totalEntries}`);
        console.log('By collection:', report.summary.byCollection);
        console.log(`\nBackup written to: ${outputPath}`);

        await mongoose.connection.close();
        console.log('\nDone. Connection closed.');
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

runAudit();
