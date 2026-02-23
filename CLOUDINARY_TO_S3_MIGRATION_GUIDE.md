# Cloudinary to S3 Migration Guide

This guide lets you migrate existing Cloudinary image URLs to AWS S3 in a new project. Use it when the target project does not yet have S3 configured.

---

## Overview

- **Phase 1**: Audit MongoDB for Cloudinary URLs → Download each image → Upload to S3 → Save mapping (Cloudinary URL → S3 URL/key)
- **Phase 2**: Update MongoDB documents using the mapping

---

## Prerequisites

- Node.js project with MongoDB and Cloudinary
- AWS account
- Images currently stored in Cloudinary and referenced in MongoDB

---

## Part A: AWS Setup (one-time)

### 1. Create S3 bucket

1. Go to [AWS S3 Console](https://s3.console.aws.amazon.com)
2. Create bucket (e.g. `your-project-bucket`)
3. Choose region (e.g. `us-east-1` or `me-central-1`)
4. Leave "Block all public access" ON for now (we enable public read later via policy)

### 2. IAM user for S3 access

1. Go to IAM → Users → Create user (e.g. `s3-uploader`)
2. Attach policy: `AmazonS3FullAccess` (or custom policy with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`)
3. Create access key (Access Key ID + Secret Access Key)
4. Save credentials for `.env`

### 3. Bucket policy (after migration)

After migration, add a bucket policy so images are publicly readable:

1. S3 → Your bucket → Permissions → Block public access → Edit → Turn OFF "Block all public access"
2. Bucket policy → Edit → Paste:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/We-QrCode/*"
        }
    ]
}
```

Replace `YOUR_BUCKET_NAME` with your bucket name.

---

## Part B: Add S3 to your Node project

### 1. Install dependencies

```bash
npm install aws-sdk uuid
```

(Ensure `dotenv` and `mongoose` are already installed.)

### 2. Environment variables

Add to `.env` or `.env.local`:

```env
# AWS S3
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name

# MongoDB (for migration scripts)
MONGODB_URI=mongodb+srv://...
# or MONGODB_CLOUD_URI or DB_URI
```

### 3. Create AWS config

**File:** `app/config/aws.js`

```javascript
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});

module.exports = {
    s3,
    bucket: process.env.AWS_S3_BUCKET,
    region: process.env.AWS_REGION
};
```

### 4. Create AWS uploader service

**File:** `app/services/awsService/aws.uploader.js`

Create the `app/services/awsService` folder if it does not exist, then add:

```javascript
const { s3, bucket, region } = require('../../config/aws');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const getBufferHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const generateS3Key = (folder, filename) => {
    const sanitizedFolder = folder ? folder.replace(/\/+/g, '/').replace(/^\/|\/$/g, '') : '';
    const sanitizedFilename = filename || `${uuidv4()}.jpg`;
    return sanitizedFolder ? `${sanitizedFolder}/${sanitizedFilename}` : sanitizedFilename;
};

const uploadImageBuffer = async (fileBuffer, Model = null, customFolder = null, mimetype = 'image/jpeg') => {
    if (!bucket) throw new Error('AWS_S3_BUCKET environment variable is not set');
    if (!s3.config.credentials) throw new Error('AWS credentials not configured');

    const modelName = Model?.modelName;
    const folder = customFolder || (modelName ? `We-QrCode/${modelName}` : 'We-QrCode');
    const extension = mimetype.split('/')[1] || 'jpg';
    const filename = `${uuidv4()}.${extension}`;
    const key = generateS3Key(folder, filename);

    const params = { Bucket: bucket, Key: key, Body: fileBuffer, ContentType: mimetype };
    const data = await s3.upload(params).promise();

    return {
        secure_url: data.Location,
        url: data.Location,
        public_id: key,
        key: key,
        etag: data.ETag
    };
};

module.exports = {
    getBufferHash,
    uploadImageBuffer,
    getS3Url: (key) => `https://${bucket}.s3.${region}.amazonaws.com/${key}`
};
```

Adjust the `require('../../config/aws')` path if your config lives elsewhere (e.g. `../config/aws` if `awsService` is under `app/`).

---

## Part C: Migration scripts

### 1. Audit script

Create `scripts/audit-cloudinary-assets.js`. This scans MongoDB for Cloudinary URLs and writes `audit-cloudinary-assets.json`.

The script below is tailored for a schema with: **User** (profilePic), **Restaurant** (qrCodeURL, images, theme.logo, theme.favIcon, theme.bannerImages, theme.offerBannerImages), **Product** (images), **Category** (image).

**Customization:** Edit the audit functions and `COLLECTIONS` to match your schema. Each audit function should push entries of the form `{ collection, objectId, field, value }` where `value` is either a URL string or `{ url, publicId, hash }`.

```javascript
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(rootDir, '.env') });
require('dotenv').config({ path: path.join(rootDir, '.env.local') });

const CLOUDINARY_DOMAIN = 'cloudinary.com';

function isCloudinaryUrl(value) {
    return typeof value === 'string' && value.trim() && value.includes(CLOUDINARY_DOMAIN);
}

function createEntry(collection, objectId, field, value) {
    return { collection, objectId, field, value };
}

function collectCloudinaryFromArray(arr, basePath, docId, collection, entries) {
    if (!Array.isArray(arr)) return;
    arr.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        if (item.url && isCloudinaryUrl(item.url)) {
            entries.push(createEntry(collection, docId, `${basePath}[${index}]`, { url: item.url, publicId: item.publicId || null, hash: item.hash || null }));
        }
    });
}

function collectCloudinaryFromObject(obj, basePath, docId, collection, entries) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.url && isCloudinaryUrl(obj.url)) {
        entries.push(createEntry(collection, docId, basePath, { url: obj.url, publicId: obj.publicId || null, hash: obj.hash || null }));
    }
}

// --- CUSTOMIZE these to match your collections and fields ---
async function auditUser(db, entries) {
    const users = await db.collection('users').find({}).toArray();
    for (const doc of users) {
        if (doc.profilePic && isCloudinaryUrl(doc.profilePic)) {
            entries.push(createEntry('User', doc._id.toString(), 'profilePic', { url: doc.profilePic, publicId: doc.profilePicPublicId || null, hash: doc.profilePicHash || null }));
        }
    }
}

async function auditRestaurant(db, entries) {
    const docs = await db.collection('restaurants').find({}).toArray();
    for (const doc of docs) {
        const docId = doc._id.toString();
        if (doc.qrCodeURL && isCloudinaryUrl(doc.qrCodeURL)) entries.push(createEntry('Restaurant', docId, 'qrCodeURL', doc.qrCodeURL));
        collectCloudinaryFromArray(doc.images, 'images', docId, 'Restaurant', entries);
        if (doc.theme) {
            collectCloudinaryFromObject(doc.theme.logo, 'theme.logo', docId, 'Restaurant', entries);
            collectCloudinaryFromObject(doc.theme.favIcon, 'theme.favIcon', docId, 'Restaurant', entries);
            collectCloudinaryFromArray(doc.theme.bannerImages, 'theme.bannerImages', docId, 'Restaurant', entries);
            collectCloudinaryFromArray(doc.theme.offerBannerImages, 'theme.offerBannerImages', docId, 'Restaurant', entries);
        }
    }
}

async function auditProduct(db, entries) {
    const docs = await db.collection('products').find({}).toArray();
    for (const doc of docs) collectCloudinaryFromArray(doc.images, 'images', doc._id.toString(), 'Product', entries);
}

async function auditCategory(db, entries) {
    const docs = await db.collection('categories').find({}).toArray();
    for (const doc of docs) {
        if (doc.image && isCloudinaryUrl(doc.image)) {
            entries.push(createEntry('Category', doc._id.toString(), 'image', { url: doc.image, publicId: doc.imagePublicId || null, hash: doc.imageHash || null }));
        }
    }
}

const COLLECTIONS = ['User', 'Restaurant', 'Product', 'Category'];

async function runAudit() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_CLOUD_URI || process.env.DB_URI;
    if (!mongoUri) {
        console.error('MongoDB URI not set. Set MONGODB_URI or MONGODB_CLOUD_URI');
        process.exit(1);
    }
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;
    const entries = [];

    await auditUser(db, entries);
    await auditRestaurant(db, entries);
    await auditProduct(db, entries);
    await auditCategory(db, entries);

    const byCollection = COLLECTIONS.reduce((acc, c) => { acc[c] = []; return acc; }, {});
    entries.forEach((e) => byCollection[e.collection].push({ objectId: e.objectId, field: e.field, value: e.value }));

    const report = {
        summary: { totalEntries: entries.length, byCollection: COLLECTIONS.reduce((acc, c) => { acc[c] = byCollection[c].length; return acc; }, {}), generatedAt: new Date().toISOString() },
        ...byCollection
    };
    fs.writeFileSync(path.join(rootDir, 'audit-cloudinary-assets.json'), JSON.stringify(report, null, 2));
    console.log('Audit complete. Total:', report.summary.totalEntries);
    await mongoose.connection.close();
    process.exit(0);
}

runAudit().catch((err) => { console.error(err); process.exit(1); });
```

### 2. Migration script

Create `scripts/migrate-cloudinary-to-s3.js`. Adjust the require path to `aws.uploader` if your project structure differs (e.g. `../app/services/awsService/aws.uploader` vs `../src/...`).

**Customization:** Update `collectionToMongo`, `buildUpdatePayload`, `getFolderForCollection`, and the `collections` list to match your schema.

```javascript
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const rootDir = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(rootDir, '.env') });
require('dotenv').config({ path: path.join(rootDir, '.env.local') });

const { uploadImageBuffer, getBufferHash } = require('../app/services/awsService/aws.uploader');

const args = process.argv.slice(2);
const getArg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);
const phaseArg = getArg('phase');
const auditPath = getArg('audit') || path.join(rootDir, 'audit-cloudinary-assets.json');
const dryRun = hasFlag('dry-run');
const runPhase1 = !phaseArg || phaseArg === '1';
const runPhase2 = !phaseArg || phaseArg === '2';
const MAPPING_PATH = path.join(rootDir, 'migration-mapping.json');
const FAILURES_PATH = path.join(rootDir, 'migration-failures.json');

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
            res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(Buffer.concat(chunks)) : reject(new Error(`HTTP ${res.statusCode}`)));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function runPhase1Mapping(audit) {
    const collections = ['User', 'Restaurant', 'Product', 'Category'];
    const entries = collections.flatMap((c) => (audit[c] || []).map((e) => ({ ...e, collection: c })));
    const urlToMeta = new Map();
    entries.forEach((e) => {
        const url = typeof e.value === 'string' ? e.value : e.value?.url;
        if (url && !urlToMeta.has(url)) urlToMeta.set(url, { collection: e.collection });
    });
    const uniqueUrls = [...urlToMeta.keys()];
    let mapping = {};
    try { if (fs.existsSync(MAPPING_PATH)) mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')).mapping || {}; } catch (_) {}
    const failures = [];
    let migrated = 0, skipped = 0;

    for (let i = 0; i < uniqueUrls.length; i++) {
        const url = uniqueUrls[i];
        if (mapping[url]) { skipped++; continue; }
        if (dryRun) { migrated++; continue; }
        try {
            const buffer = await fetchUrl(url);
            const result = await uploadImageBuffer(buffer, null, getFolderForCollection(urlToMeta.get(url).collection), getMimetypeFromUrl(url));
            mapping[url] = { s3Url: result.url, s3Key: result.key, hash: getBufferHash(buffer) };
            migrated++;
            fs.writeFileSync(MAPPING_PATH, JSON.stringify({ mapping, updatedAt: new Date().toISOString() }, null, 2));
        } catch (err) {
            failures.push({ url, error: err.message });
            console.error('Failed:', url.slice(0, 60), err.message);
        }
    }
    if (failures.length) fs.writeFileSync(FAILURES_PATH, JSON.stringify({ failures, updatedAt: new Date().toISOString() }, null, 2));
    console.log('Phase 1:', migrated, 'migrated,', skipped, 'skipped,', failures.length, 'failed');
    return { mapping };
}

function collectionToMongo(collection) {
    const map = { User: 'users', Restaurant: 'restaurants', Product: 'products', Category: 'categories' };
    return map[collection] || collection.toLowerCase() + 's';
}

function buildUpdatePayload(field, s3Url, s3Key) {
    if (field === 'profilePic') return { profilePic: s3Url, profilePicPublicId: s3Key };
    if (field === 'qrCodeURL') return { qrCodeURL: s3Url };
    if (field === 'image') return { image: s3Url, imagePublicId: s3Key };
    const imgMatch = field.match(/images\[(\d+)\]/);
    if (imgMatch) return { [`images.${imgMatch[1]}.url`]: s3Url, [`images.${imgMatch[1]}.publicId`]: s3Key };
    const themeMatch = field.match(/^theme\.(logo|favIcon|bannerImages|offerBannerImages)(?:\[(\d+)\])?$/);
    if (themeMatch) {
        const [, sub, idx] = themeMatch;
        return idx !== undefined
            ? { [`theme.${sub}.${idx}.url`]: s3Url, [`theme.${sub}.${idx}.publicId`]: s3Key }
            : { [`theme.${sub}.url`]: s3Url, [`theme.${sub}.publicId`]: s3Key };
    }
    return {};
}

async function runPhase2DbUpdate(audit, mapping) {
    const collections = ['User', 'Restaurant', 'Product', 'Category'];
    const entries = collections.flatMap((c) => (audit[c] || []).map((e) => ({ ...e, collection: c })));
    let updated = 0;
    const failures = [];
    for (const e of entries) {
        const url = typeof e.value === 'string' ? e.value : e.value?.url;
        if (!url) continue;
        const mapped = mapping[url];
        if (!mapped) { failures.push({ objectId: e.objectId, field: e.field, reason: 'URL not in mapping' }); continue; }
        const payload = buildUpdatePayload(e.field, mapped.s3Url, mapped.s3Key);
        if (Object.keys(payload).length === 0) { failures.push({ objectId: e.objectId, field: e.field, reason: 'Unknown field' }); continue; }
        if (dryRun) { updated++; continue; }
        try {
            const coll = mongoose.connection.db.collection(collectionToMongo(e.collection));
            await coll.updateOne({ _id: new mongoose.Types.ObjectId(e.objectId) }, { $set: payload });
            updated++;
        } catch (err) {
            failures.push({ objectId: e.objectId, error: err.message });
        }
    }
    if (failures.length) fs.writeFileSync(FAILURES_PATH, JSON.stringify({ phase: 'Phase 2', failures, updatedAt: new Date().toISOString() }, null, 2));
    console.log('Phase 2:', updated, 'updated,', failures.length, 'failed');
}

async function main() {
    if (!fs.existsSync(auditPath)) { console.error('Run audit first: node scripts/audit-cloudinary-assets.js'); process.exit(1); }
    if (runPhase1 && !dryRun) {
        const missing = ['AWS_S3_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'].filter((k) => !process.env[k]);
        if (missing.length) { console.error('Missing:', missing.join(', ')); process.exit(1); }
    }
    const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_CLOUD_URI || process.env.DB_URI;
    if (!mongoUri) { console.error('MongoDB URI not set'); process.exit(1); }
    if (runPhase2 && !fs.existsSync(MAPPING_PATH)) { console.error('Run Phase 1 first'); process.exit(1); }

    await mongoose.connect(mongoUri);
    const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
    let mapping = {};

    if (runPhase1) {
        const r = await runPhase1Mapping(audit);
        mapping = r.mapping;
        if (Object.keys(mapping).length === 0 && fs.existsSync(MAPPING_PATH)) mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')).mapping || {};
    }
    if (runPhase2) {
        if (Object.keys(mapping).length === 0 && fs.existsSync(MAPPING_PATH)) mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')).mapping || {};
        await runPhase2DbUpdate(audit, mapping);
    }
    await mongoose.connection.close();
    process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

---

## Part D: Run the migration

```bash
# 1. Audit (creates audit-cloudinary-assets.json)
node scripts/audit-cloudinary-assets.js

# 2. Phase 1 – download from Cloudinary, upload to S3, build mapping
node scripts/migrate-cloudinary-to-s3.js --phase=1

# 3. Phase 2 – update MongoDB with S3 URLs
node scripts/migrate-cloudinary-to-s3.js --phase=2

# 4. Re-run audit to verify (should show only failed entries left)
node scripts/audit-cloudinary-assets.js
```

Optional:

- `--dry-run` – simulate without uploads/DB writes  
- `--audit=./custom-audit.json` – use custom audit file

---

## Part E: S3 bucket policy (public read)

After migration, configure S3 so images are publicly readable:

1. S3 → Bucket → Permissions  
2. Block public access → Edit → Turn OFF "Block all public access"  
3. Bucket policy → Edit → Add policy (replace `YOUR_BUCKET_NAME`):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/We-QrCode/*"
        }
    ]
}
```

---

## Part F: Customizing for different projects

### Different collections

- Audit script: add/remove audit functions, update `COLLECTIONS`
- Migration script: update `collectionToMongo`, `getFolderForCollection`, and the `collections` array

### Different field structure

Update `buildUpdatePayload` to match your schema. For example:

- Single URL: `{ fieldName: s3Url }`
- URL + key: `{ fieldName: s3Url, fieldNamePublicId: s3Key }`
- Array item: `{ "arrayField.0.url": s3Url, "arrayField.0.publicId": s3Key }`

### Different app layout

- If config is at `src/config/aws.js`, adjust `require` paths in the uploader and migration script
- If the uploader lives elsewhere, update the migration script’s `require('../app/services/awsService/aws.uploader')`

### Different S3 prefix

Update `getFolderForCollection` and the bucket policy `Resource` to use your prefix instead of `We-QrCode/*`.

---

## Output files

| File | Description |
|------|-------------|
| `audit-cloudinary-assets.json` | Snapshot of Cloudinary URLs in MongoDB |
| `migration-mapping.json` | Cloudinary URL → S3 URL/key mapping |
| `migration-failures.json` | Failed URLs and DB updates |

Add these to `.gitignore` if you don’t want them committed:

```
migration-mapping.json
migration-failures.json
```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `AWS_S3_BUCKET not set` | Add AWS vars to `.env` or `.env.local` |
| `Access Denied` when viewing images | Add or correct bucket policy (Part E) |
| Audit shows same count after Phase 2 | Ensure migration and audit use same `MONGODB_URI` |
| HTTP 404 during Phase 1 | Some Cloudinary URLs no longer exist; they will stay in failures |
| Wrong DB updated | Check `MONGODB_URI` / `MONGODB_CLOUD_URI` in `.env` |

---

## Quick checklist

- [ ] AWS bucket created  
- [ ] IAM user + access keys created  
- [ ] Dependencies installed (`aws-sdk`, `uuid`)  
- [ ] `app/config/aws.js` created  
- [ ] `app/services/awsService/aws.uploader.js` created  
- [ ] `.env` has AWS + MongoDB vars  
- [ ] Audit script customized for schema  
- [ ] Migration script customized for schema  
- [ ] Run audit → Phase 1 → Phase 2  
- [ ] Add S3 bucket policy for public read  
