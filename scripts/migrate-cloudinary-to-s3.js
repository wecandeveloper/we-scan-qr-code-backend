/**
 * Cloudinary to S3 Migration Script
 *
 * Two-phase migration:
 *   Phase 1: Download from Cloudinary → Upload to S3 → Build mapping file
 *   Phase 2: Update MongoDB documents using mapping
 *
 * Usage:
 *   node scripts/migrate-cloudinary-to-s3.js --phase=1          # Build mapping only
 *   node scripts/migrate-cloudinary-to-s3.js --phase=2          # Update DB only (requires mapping)
 *   node scripts/migrate-cloudinary-to-s3.js                    # Run both phases
 *   node scripts/migrate-cloudinary-to-s3.js --phase=1 --dry-run  # Simulate Phase 1
 *   node scripts/migrate-cloudinary-to-s3.js --audit=./custom-audit.json
 *
 * Requires: audit-cloudinary-assets.json (or --audit path)
 * Output: migration-mapping.json (Phase 1 - Cloudinary URL -> S3 URL/key mapping),
 *         migration-failures.json (on errors)
 *
 * Note: Both migration and audit scripts use MONGODB_URI/MONGODB_CLOUD_URI from .env
 *       Ensure they point to the same database you intend to update.
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Load .env and .env.local (local overrides)
const rootDir = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(rootDir, '.env') });
require('dotenv').config({ path: path.join(rootDir, '.env.local') });

const { uploadImageBuffer, getBufferHash } = require('../app/services/awsService/aws.uploader');

// --- CLI args ---
const args = process.argv.slice(2);
const getArg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);
const phaseArg = getArg('phase'); // '1' | '2'
const auditPath = getArg('audit') || path.join(__dirname, '..', 'audit-cloudinary-assets.json');
const dryRun = hasFlag('dry-run');
const runPhase1 = !phaseArg || phaseArg === '1';
const runPhase2 = !phaseArg || phaseArg === '2';

const MAPPING_PATH = path.join(__dirname, '..', 'migration-mapping.json');
const FAILURES_PATH = path.join(__dirname, '..', 'migration-failures.json');

// --- Helpers ---
function getMimetypeFromUrl(url) {
    const ext = path.extname(new URL(url).pathname).toLowerCase().slice(1);
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
    return map[ext] || 'image/jpeg';
}

function getFolderForCollection(collection) {
    const folders = { User: 'We-QrCode/User', Restaurant: 'We-QrCode/Restaurant', Product: 'We-QrCode/Product', Category: 'We-QrCode/Category' };
    return folders[collection] || 'We-QrCode';
}

async function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(Buffer.concat(chunks));
                } else {
                    reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// --- Phase 1: Build mapping ---
async function runPhase1Mapping(audit) {
    const entries = [];
    const collections = ['User', 'Restaurant', 'Product', 'Category'];
    for (const c of collections) {
        if (audit[c]) entries.push(...audit[c].map((e) => ({ ...e, collection: c })));
    }

    const urlToMeta = new Map();
    for (const e of entries) {
        const url = typeof e.value === 'string' ? e.value : e.value?.url;
        if (!url) continue;
        if (!urlToMeta.has(url)) {
            urlToMeta.set(url, {
                collection: e.collection,
                field: e.field,
                hash: typeof e.value === 'object' ? e.value?.hash : null,
            });
        }
    }

    const uniqueUrls = [...urlToMeta.keys()];
    let mapping = {};
    try {
        if (fs.existsSync(MAPPING_PATH)) {
            const loaded = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
            mapping = loaded.mapping || loaded;
        }
    } catch (_) {}

    const failures = [];
    let migrated = 0;
    let skipped = 0;

    console.log(`\n--- Phase 1: Building mapping (${dryRun ? 'DRY RUN' : 'LIVE'}) ---`);
    console.log(`Unique URLs: ${uniqueUrls.length} (of ${entries.length} total refs)`);

    for (let i = 0; i < uniqueUrls.length; i++) {
        const url = uniqueUrls[i];
        const meta = urlToMeta.get(url);

        if (mapping[url]) {
            skipped++;
            if (i % 50 === 0 || i === uniqueUrls.length - 1) {
                console.log(`  Progress: ${i + 1}/${uniqueUrls.length} (skipped ${skipped} already in mapping)`);
            }
            continue;
        }

        if (dryRun) {
            console.log(`  [DRY RUN] Would migrate: ${url.slice(0, 80)}...`);
            migrated++;
            continue;
        }

        try {
            const buffer = await fetchUrl(url);
            const mimetype = getMimetypeFromUrl(url);
            const folder = getFolderForCollection(meta.collection);

            const result = await uploadImageBuffer(buffer, null, folder, mimetype);
            mapping[url] = {
                s3Url: result.url,
                s3Key: result.key,
                hash: getBufferHash(buffer),
            };
            migrated++;
            fs.writeFileSync(MAPPING_PATH, JSON.stringify({ mapping, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        } catch (err) {
            failures.push({ url, error: err.message });
            console.error(`  Failed: ${url.slice(0, 60)}... - ${err.message}`);
        }

        if ((i + 1) % 20 === 0) {
            console.log(`  Progress: ${i + 1}/${uniqueUrls.length} (migrated ${migrated}, failed ${failures.length})`);
        }
    }

    if (failures.length > 0) {
        fs.writeFileSync(FAILURES_PATH, JSON.stringify({ failures, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        console.log(`\nFailures written to: ${FAILURES_PATH}`);
    }

    console.log(`\nPhase 1 complete: ${migrated} migrated, ${skipped} skipped (from checkpoint), ${failures.length} failed`);
    return { mapping, failures };
}

// --- Phase 2: Update DB ---
function collectionToMongo(collection) {
    const map = { User: 'users', Restaurant: 'restaurants', Product: 'products', Category: 'categories' };
    return map[collection] || collection.toLowerCase() + 's';
}

function buildUpdatePayload(field, s3Url, s3Key) {
    if (field === 'profilePic') {
        return { profilePic: s3Url, profilePicPublicId: s3Key };
    }
    if (field === 'qrCodeURL') {
        return { qrCodeURL: s3Url };
    }
    if (field === 'image') {
        return { image: s3Url, imagePublicId: s3Key };
    }
    if (field.startsWith('images[')) {
        const idx = field.match(/images\[(\d+)\]/)?.[1];
        if (idx === undefined) return {};
        return {
            [`images.${idx}.url`]: s3Url,
            [`images.${idx}.publicId`]: s3Key,
        };
    }
    if (field.startsWith('theme.')) {
        const m = field.match(/^theme\.(logo|favIcon|bannerImages|offerBannerImages)(?:\[(\d+)\])?$/);
        if (!m) return {};
        const [, sub, idx] = m;
        if (idx !== undefined) {
            return {
                [`theme.${sub}.${idx}.url`]: s3Url,
                [`theme.${sub}.${idx}.publicId`]: s3Key,
            };
        }
        return {
            [`theme.${sub}.url`]: s3Url,
            [`theme.${sub}.publicId`]: s3Key,
        };
    }
    return {};
}

async function runPhase2DbUpdate(audit, mapping) {
    const entries = [];
    const collections = ['User', 'Restaurant', 'Product', 'Category'];
    for (const c of collections) {
        if (audit[c]) entries.push(...audit[c].map((e) => ({ ...e, collection: c })));
    }

    let updated = 0;
    const failures = [];

    console.log(`\n--- Phase 2: Updating database (${dryRun ? 'DRY RUN' : 'LIVE'}) ---`);
    console.log(`Mapping: ${Object.keys(mapping).length} Cloudinary URLs -> S3 URLs (see migration-mapping.json for full trace)`);
    console.log(`Entries to process: ${entries.length}`);

    for (const e of entries) {
        const url = typeof e.value === 'string' ? e.value : e.value?.url;
        if (!url) continue;

        const mapped = mapping[url];
        if (!mapped) {
            failures.push({ objectId: e.objectId, field: e.field, url: url.slice(0, 80), reason: 'URL not in mapping' });
            continue;
        }

        const payload = buildUpdatePayload(e.field, mapped.s3Url, mapped.s3Key);
        if (Object.keys(payload).length === 0) {
            failures.push({ objectId: e.objectId, field: e.field, url: url.slice(0, 80), reason: 'Unknown field format' });
            continue;
        }

        if (dryRun) {
            console.log(`  [DRY RUN] Would update ${e.collection} ${e.objectId} ${e.field}`);
            updated++;
            continue;
        }

        try {
            const collName = collectionToMongo(e.collection);
            const coll = mongoose.connection.db.collection(collName);
            await coll.updateOne({ _id: new mongoose.Types.ObjectId(e.objectId) }, { $set: payload });
            updated++;
        } catch (err) {
            failures.push({ objectId: e.objectId, field: e.field, error: err.message });
            console.error(`  Failed update ${e.collection}/${e.objectId}: ${err.message}`);
        }
    }

    if (failures.length > 0) {
        fs.writeFileSync(FAILURES_PATH, JSON.stringify({ phase: 'Phase 2', failures, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
        console.log(`\nFailures written to: ${FAILURES_PATH}`);
    }

    console.log(`\nPhase 2 complete: ${updated} updated, ${failures.length} failed`);
}

// --- Main ---
function validateEnv() {
    if (!runPhase1 || dryRun) return;
    const required = ['AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
        console.error('Missing required env vars for Phase 1 (S3 upload):', missing.join(', '));
        console.error('Ensure these are set in .env or .env.local');
        process.exit(1);
    }
}

async function main() {
    if (!fs.existsSync(auditPath)) {
        console.error(`Audit file not found: ${auditPath}`);
        console.error('Run: node scripts/audit-cloudinary-assets.js first');
        process.exit(1);
    }

    validateEnv();

    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    let mapping = {};

    const mongoUri = process.env.MONGODB_CLOUD_URI || process.env.MONGODB_CLOUD_URI || process.env.DB_URI;
    if (!mongoUri && (runPhase2 || runPhase1 && !dryRun)) {
        console.error('MongoDB URI not set. Set MONGODB_URI or MONGODB_CLOUD_URI');
        process.exit(1);
    }

    if (runPhase2 && !runPhase1 && !fs.existsSync(MAPPING_PATH)) {
        console.error('Mapping file not found. Run Phase 1 first: node scripts/migrate-cloudinary-to-s3.js --phase=1');
        process.exit(1);
    }

    try {
        if (mongoUri) {
            await mongoose.connect(mongoUri);
            const dbName = mongoose.connection.db?.databaseName || 'unknown';
            console.log('Connected to MongoDB - DB:', dbName);
        }

        if (runPhase1) {
            const result = await runPhase1Mapping(audit);
            mapping = result.mapping;
            if (Object.keys(mapping).length === 0 && fs.existsSync(MAPPING_PATH)) {
                const loaded = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
                mapping = loaded.mapping || loaded;
            }
        }

        if (runPhase2) {
            if (Object.keys(mapping).length === 0 && fs.existsSync(MAPPING_PATH)) {
                const loaded = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
                mapping = loaded.mapping || loaded;
            }
            await runPhase2DbUpdate(audit, mapping);
        }

        console.log('\n--- Migration script finished ---');
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    } finally {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
        }
        process.exit(0);
    }
}

main();
