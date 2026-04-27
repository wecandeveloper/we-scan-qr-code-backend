# Object storage migration guide (DigitalOcean Spaces)

## 📋 Migration Summary

This guide outlines object storage for uploads: **DigitalOcean Spaces** (S3-compatible API via `aws-sdk` v2), with backward compatibility for **legacy AWS S3 URLs** and **Cloudinary** URLs still stored in the database.

## 🎯 Migration Strategy: Gradual Dual-Provider Approach

### ✅ What We've Implemented

1. **Spaces uploader** (`app/services/awsService/aws.uploader.js`)
   - Same surface area as the Cloudinary uploader where applicable
   - Functions: `uploadImageBuffer`, `processMultipleImageBuffers`, `deleteS3Images`, `getSignedGetObjectUrl`, etc.

2. **Unified Uploader Service** (`app/services/unifiedUploader/unified.uploader.js`)
   - **Provider detection**: Cloudinary vs object storage (Spaces CDN, DigitalOcean hostnames, legacy AWS S3 URLs)
   - **New uploads → Spaces** via S3-compatible API
   - **Unified delete**: Routes to Cloudinary or Spaces as appropriate

3. **Configuration** (`app/config/aws.js`)
   - DigitalOcean Spaces endpoint, credentials, bucket, CDN base URL (filename kept for minimal import churn)

## 🔄 How It Works

### Current State (Before Migration)
```
Controllers → Cloudinary Service → Cloudinary
```

### During migration (dual provider)
```
Controllers → Unified Service → {
  New uploads → DigitalOcean Spaces
  Old URLs → Cloudinary (for deletion/operations)
}
```

### After full migration (optional)
```
Controllers → Unified Service → Spaces (only) + legacy URL support until data is rewritten
```

## 📝 Migration Steps

### Step 1: Install Required Dependencies

```bash
npm install aws-sdk
```

**Note**: If you prefer the newer AWS SDK v3, you can use:
```bash
npm install @aws-sdk/client-s3
```
(If using v3, you'll need to update `app/config/aws.js` accordingly)

### Step 2: Environment variables

Set these in `.env` (see also `env.saas.example`):

```env
# DigitalOcean Spaces (S3-compatible)
DO_SPACES_KEY=your_spaces_access_key
DO_SPACES_SECRET=your_spaces_secret
DO_SPACES_BUCKET=your_space_name
DO_SPACES_ENDPOINT=nyc3.digitaloceanspaces.com
DO_SPACES_REGION=nyc3
DO_SPACES_CDN_URL=https://your-space-name.nyc3.cdn.digitaloceanspaces.com
# Optional: set to none if uploads fail with ACL errors (use Space file listing / bucket policy for public reads)
# DO_SPACES_OBJECT_ACL=none

# Keep Cloudinary for backward compatibility
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Step 3: Update Controllers (Gradual Migration)

**Option A: Use Unified Service (Recommended)**

Replace Cloudinary imports with Unified service:

```javascript
// OLD
const { uploadImageBuffer, deleteCloudinaryImages, processMultipleImageBuffers } = require('../services/cloudinaryService/cloudinary.uploader');

// NEW
const { uploadImageBuffer, deleteImages, processMultipleImageBuffers } = require('../services/unifiedUploader/unified.uploader');
```

Then update delete calls:
```javascript
// OLD
await deleteCloudinaryImages(publicIds);

// NEW (automatically handles both Cloudinary and S3)
await deleteImages(publicIdsOrUrls);
```

**Option B: Direct AWS Service (If you want to force S3 only)**

```javascript
const { uploadImageBuffer, deleteS3Images, processMultipleImageBuffers } = require('../services/awsService/aws.uploader');
```

### Step 4: Update Models (Optional but Recommended)

Your models currently store:
- `url`: Image URL
- `publicId`: Cloudinary public ID

For S3 compatibility, you can add:
- `key`: S3 key (stored in `publicId` field for backward compatibility)

The unified service handles this automatically - it stores S3 keys in the `publicId` field, so your existing code continues to work.

### Step 5: Test Migration

1. **Test New Uploads**: Upload new images - they should go to S3
2. **Test Old URLs**: Try deleting old Cloudinary images - should still work
3. **Test Duplicate Detection**: Upload same image twice - should reuse existing

### Step 6: Monitor & Verify

- Check S3 bucket for new uploads
- Verify old Cloudinary URLs still work
- Monitor for any errors in logs

## 🔍 Key Functions Comparison

| Cloudinary Function | Spaces (S3 API) | Unified Function |
|-------------------|-----------------|------------------|
| `uploadImageBuffer()` | `uploadImageBuffer()` | `uploadImageBuffer()` → **Spaces** |
| `processMultipleImageBuffers()` | `processMultipleImageBuffers()` | `processMultipleImageBuffers()` → **Spaces** |
| `deleteCloudinaryImages()` | `deleteS3Images()` | `deleteImages()` → **Auto-detect** |
| `getBufferHash()` | `getBufferHash()` | `getBufferHash()` (same) |
| `findDuplicateImage()` | `findDuplicateImage()` | `findDuplicateImage()` (same) |

## 🛡️ Backward Compatibility

### How It Handles Old Cloudinary URLs

1. **Delete Operations**:
   ```javascript
   // Unified service automatically detects provider
   await deleteImages(['https://res.cloudinary.com/...']); // → Cloudinary
   await deleteImages(['https://bucket.s3.region.amazonaws.com/...']); // → legacy AWS key extraction
   await deleteImages(['https://<cdn>/We-QrCode/...']); // → Spaces (CDN prefix from DO_SPACES_CDN_URL)
   ```

2. **URL detection**:
   - URLs containing `cloudinary.com` → Cloudinary
   - URLs containing `amazonaws.com` or `s3.` (path-style) → object storage
   - URLs containing `digitaloceanspaces.com` → object storage
   - URLs starting with `DO_SPACES_CDN_URL` → object storage

3. **PublicId/Key Handling**:
   - Cloudinary publicIds: Short format (e.g., `folder/filename`)
   - S3 keys: Longer paths (e.g., `We-QrCode/Restaurant/Gallery/uuid.jpg`)
   - Unified service handles both formats

## ⚠️ Important Notes

1. **Don't Delete Cloudinary Functions**: Keep them for backward compatibility with old URLs
2. **Gradual Migration**: You can migrate controllers one by one
3. **Database URLs**: Old Cloudinary URLs in database will continue to work
4. **New uploads**: All new uploads go to DigitalOcean Spaces; public URLs use `DO_SPACES_CDN_URL` when set
5. **No Breaking Changes**: Existing code continues to work during migration

## 🚀 Future: Full Migration (Optional)

Once you're confident all new uploads are on S3 and you want to migrate old files:

1. **Create Migration Script**: Download Cloudinary files → Upload to S3 → Update database
2. **Run Script**: Migrate all old Cloudinary URLs to S3
3. **Remove Cloudinary**: Once 100% migrated, remove Cloudinary code

(We can create this migration script later if needed)

## 📂 Files Created/Modified

### Key files:
- `app/config/aws.js` - Spaces endpoint, credentials, CDN base
- `app/services/awsService/aws.uploader.js` - Upload, delete, URL helpers, optional presigned GET
- `app/services/unifiedUploader/unified.uploader.js` - Unified entry point for controllers

### Existing Files (Keep As-Is):
- `app/services/cloudinaryService/cloudinary.uploader.js` - **Keep for backward compatibility**
- `app/services/cloudinaryService/cloudinary.multer.js` - **Keep for backward compatibility**
- `app/config/cloudinary.js` - **Keep for backward compatibility**

## ✅ Migration Checklist

- [x] Spaces uploader (`aws-sdk` S3 client + DO endpoint)
- [x] Unified service with auto-detection
- [x] Configuration file (`app/config/aws.js`)
- [ ] Install `aws-sdk` package (`npm install`)
- [ ] Set `DO_SPACES_*` environment variables
- [ ] Update controllers to use unified service (gradual)
- [ ] Test new uploads (appear in Space; API returns CDN URL)
- [ ] Test old URL deletion (should still work)
- [ ] Monitor for errors
- [ ] (Optional) Create migration script for old files

## 🆘 Troubleshooting

### Issue: "AWS SDK not found"
**Solution**: Run `npm install aws-sdk`

### Issue: Access denied when uploading
**Solution**: Verify Spaces keys, bucket name, and that the access key can `PutObject` / `DeleteObject`

### Issue: Old Cloudinary URLs not deleting
**Solution**: Ensure Cloudinary environment variables are still set

### Issue: Images not publicly accessible
**Solution**: Ensure Space or CDN allows anonymous read; set `DO_SPACES_OBJECT_ACL=none` and use a public-read bucket policy if ACLs are disabled

### Issue: Presigned URLs for private files
**Solution**: Use `getSignedGetObjectUrl` from `app/services/awsService/aws.uploader.js` (same S3 client / bucket)

## 📞 Next Steps

1. **Review the implementation** - all files are ready
2. **Install dependencies** - `npm install aws-sdk`
3. **Set environment variables** - Add `DO_SPACES_*` values
4. **Start migrating controllers** - Use unified service gradually
5. **Test thoroughly** - Verify both old and new URLs work

---

**Summary**: Designed for **zero-downtime** and **backward compatibility**: Cloudinary and legacy AWS S3 URLs still delete correctly; new uploads use DigitalOcean Spaces with CDN-first public URLs when `DO_SPACES_CDN_URL` is set.

