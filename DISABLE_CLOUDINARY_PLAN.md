# Plan: Disable Cloudinary Integration

This plan removes all Cloudinary dependencies from the codebase while ensuring **zero production impact**. Execute in the order listed.

---

## Production Safety Summary

| Operation | Current | After Changes | Impact |
|-----------|---------|---------------|--------|
| **Upload** | S3 only (via unified/aws) | Unchanged | None |
| **Delete** (S3 URL/key) | Routes to awsService | Unchanged | None |
| **Delete** (Cloudinary URL) | Routes to cloudinaryService | No-op (skipped) | None – assets migrated or 404 |
| **getBufferHash** | From cloudinaryService | From awsService (identical) | None |
| **findDuplicateImage** | From cloudinaryService | From awsService (identical) | None |
| **Display** | Uses DB URLs (S3) | Unchanged | None |

---

## Step 1: Update Unified Uploader

**File:** `app/services/unifiedUploader/unified.uploader.js`

### 1.1 Switch getBufferHash and findDuplicateImage to AWS service

- Change `getBufferHash = cloudinaryService.getBufferHash` to `getBufferHash = awsService.getBufferHash`
- Change `findDuplicateImage = cloudinaryService.findDuplicateImage` to `findDuplicateImage = awsService.findDuplicateImage`

### 1.2 Handle Cloudinary items in deleteImages as no-op

- Replace the block that calls `cloudinaryService.deleteCloudinaryImages(cloudinaryItems)` with a no-op:
  - If `cloudinaryItems.length > 0`: log a debug message (optional) and skip – do not call Cloudinary
  - Reason: DB images are migrated to S3; remaining Cloudinary refs are 404. Skipping avoids SDK dependency and errors.

### 1.3 Update heuristic for uncertain items

- For items that currently go to `cloudinaryItems` via the heuristic (non-URL, looks like Cloudinary publicId): route them to the same no-op path instead of Cloudinary delete
  - In practice: when the heuristic would push to `cloudinaryItems`, push to a "skip" list and do nothing (or log)

### 1.4 Remove Cloudinary imports and exports

- Remove `const cloudinaryService = require('../cloudinaryService/cloudinary.uploader');`
- Remove `cloudinary: cloudinaryService` from module.exports

---

## Step 2: Remove Unused Cloudinary Import from Restaurant Controller

**File:** `app/controllers/restaurant.controller.js`

- Remove line 2: `const cloudinary = require('../config/cloudinary');`
- This import is unused.

---

## Step 3: Delete Cloudinary Service and Config

**Files to delete:**
- `app/services/cloudinaryService/cloudinary.uploader.js`
- `app/config/cloudinary.js`

**Note:** Check if `cloudinaryService` or `cloudinary` config are required elsewhere before deletion. After Step 1 and 2, they should not be.

---

## Step 4: Handle Legacy Controller Copy

**File:** `app/controllers/restauranat.controller.copy.js`

- **Option A:** Delete the file if it is only a backup and not used.
- **Option B:** Update it to use `unifiedUploader` instead of `cloudinaryService`:
  - Replace `require('../services/cloudinaryService/cloudinary.uploader')` with `require('../services/unifiedUploader/unified.uploader')`
  - Replace `deleteCloudinaryImages` with `deleteImages`

**Note:** Production uses `restaurant.controller.js` (from `restaurant.routes.js`). This copy is not in the route chain.

---

## Step 5: Remove NPM Dependencies

```bash
npm uninstall cloudinary multer-storage-cloudinary
```

- `multer-storage-cloudinary` is not used (unified.multer uses memoryStorage).

---

## Step 6: Remove Cloudinary Env Vars (Manual)

Remove from production `.env`:
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

---

## Step 7: Optional – Remove cloudinaryService Folder

If `app/services/cloudinaryService/` contains no other files, remove the folder after deleting `cloudinary.uploader.js`.

---

## Verification Checklist

Before deploy:
- [ ] Run `node index.js` or `npm start` – app starts without errors
- [ ] Upload a new image (User/Restaurant/Product/Category) – succeeds
- [ ] Replace/delete an existing S3 image – succeeds
- [ ] Trigger an email (e.g. OTP) – logo displays (using your updated URL)
- [ ] No `require('cloudinary')` or `require('../config/cloudinary')` remains in used code

After deploy:
- [ ] Verify uploads work
- [ ] Verify image display on live site
- [ ] Verify delete-on-replace works for S3 images
- [ ] Remove Cloudinary env vars from production

---

## Files Changed Summary

| File | Action |
|------|--------|
| `app/services/unifiedUploader/unified.uploader.js` | Use awsService for getBufferHash, findDuplicateImage; no-op Cloudinary deletes; remove cloudinaryService |
| `app/controllers/restaurant.controller.js` | Remove cloudinary import |
| `app/services/cloudinaryService/cloudinary.uploader.js` | Delete |
| `app/config/cloudinary.js` | Delete |
| `app/controllers/restauranat.controller.copy.js` | Update or delete |
| `package.json` | Remove cloudinary, multer-storage-cloudinary |
