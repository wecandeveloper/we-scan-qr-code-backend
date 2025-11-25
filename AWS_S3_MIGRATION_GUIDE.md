# AWS S3 Migration Guide

## 📋 Migration Summary

This guide outlines the migration from Cloudinary to AWS S3 while maintaining backward compatibility with existing Cloudinary URLs.

## 🎯 Migration Strategy: Gradual Dual-Provider Approach

### ✅ What We've Implemented

1. **AWS S3 Service** (`app/services/awsService/aws.uploader.js`)
   - Matching functions to Cloudinary service
   - Same API structure for easy migration
   - Functions: `uploadImageBuffer`, `processMultipleImageBuffers`, `deleteS3Images`, etc.

2. **Unified Uploader Service** (`app/services/unifiedUploader/unified.uploader.js`)
   - **Smart Provider Detection**: Automatically detects Cloudinary vs S3 URLs
   - **New Uploads → S3**: All new uploads go to AWS S3
   - **Old URLs → Cloudinary**: Old Cloudinary URLs are still handled correctly
   - **Unified Delete**: Automatically routes delete operations to the correct provider

3. **AWS Configuration** (`app/config/aws.js`)
   - Centralized AWS S3 configuration

4. **AWS Multer** (`app/services/awsService/aws.multer.js`)
   - Matches Cloudinary multer structure
   - Same file filtering and memory storage

## 🔄 How It Works

### Current State (Before Migration)
```
Controllers → Cloudinary Service → Cloudinary
```

### During Migration (Dual Provider)
```
Controllers → Unified Service → {
  New Uploads → AWS S3
  Old URLs → Cloudinary (for deletion/operations)
}
```

### After Full Migration
```
Controllers → Unified Service → AWS S3 (only)
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

### Step 2: Environment Variables

Ensure these are set in your `.env` file:

```env
# AWS S3 Configuration
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=your_region (e.g., us-east-1)
AWS_S3_BUCKET=your_bucket_name

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

| Cloudinary Function | AWS S3 Function | Unified Function |
|-------------------|-----------------|------------------|
| `uploadImageBuffer()` | `uploadImageBuffer()` | `uploadImageBuffer()` → **S3** |
| `processMultipleImageBuffers()` | `processMultipleImageBuffers()` | `processMultipleImageBuffers()` → **S3** |
| `deleteCloudinaryImages()` | `deleteS3Images()` | `deleteImages()` → **Auto-detect** |
| `getBufferHash()` | `getBufferHash()` | `getBufferHash()` (same) |
| `findDuplicateImage()` | `findDuplicateImage()` | `findDuplicateImage()` (same) |

## 🛡️ Backward Compatibility

### How It Handles Old Cloudinary URLs

1. **Delete Operations**:
   ```javascript
   // Unified service automatically detects provider
   await deleteImages(['https://res.cloudinary.com/...']); // → Cloudinary
   await deleteImages(['https://bucket.s3.region.amazonaws.com/...']); // → S3
   ```

2. **URL Detection**:
   - URLs containing `cloudinary.com` → Cloudinary
   - URLs containing `amazonaws.com` or `s3.` → S3

3. **PublicId/Key Handling**:
   - Cloudinary publicIds: Short format (e.g., `folder/filename`)
   - S3 keys: Longer paths (e.g., `We-QrCode/Restaurant/Gallery/uuid.jpg`)
   - Unified service handles both formats

## ⚠️ Important Notes

1. **Don't Delete Cloudinary Functions**: Keep them for backward compatibility with old URLs
2. **Gradual Migration**: You can migrate controllers one by one
3. **Database URLs**: Old Cloudinary URLs in database will continue to work
4. **New Uploads**: All new uploads automatically go to S3
5. **No Breaking Changes**: Existing code continues to work during migration

## 🚀 Future: Full Migration (Optional)

Once you're confident all new uploads are on S3 and you want to migrate old files:

1. **Create Migration Script**: Download Cloudinary files → Upload to S3 → Update database
2. **Run Script**: Migrate all old Cloudinary URLs to S3
3. **Remove Cloudinary**: Once 100% migrated, remove Cloudinary code

(We can create this migration script later if needed)

## 📂 Files Created/Modified

### New Files:
- `app/config/aws.js` - AWS S3 configuration
- `app/services/awsService/aws.uploader.js` - AWS S3 uploader service
- `app/services/awsService/aws.multer.js` - AWS multer configuration (fixed)
- `app/services/unifiedUploader/unified.uploader.js` - Unified service

### Existing Files (Keep As-Is):
- `app/services/cloudinaryService/cloudinary.uploader.js` - **Keep for backward compatibility**
- `app/services/cloudinaryService/cloudinary.multer.js` - **Keep for backward compatibility**
- `app/config/cloudinary.js` - **Keep for backward compatibility**

## ✅ Migration Checklist

- [x] AWS S3 service created with matching functions
- [x] Unified service with auto-detection
- [x] AWS configuration file
- [x] AWS multer configuration
- [ ] Install `aws-sdk` package
- [ ] Set environment variables
- [ ] Update controllers to use unified service (gradual)
- [ ] Test new uploads (should go to S3)
- [ ] Test old URL deletion (should still work)
- [ ] Monitor for errors
- [ ] (Optional) Create migration script for old files

## 🆘 Troubleshooting

### Issue: "AWS SDK not found"
**Solution**: Run `npm install aws-sdk`

### Issue: "Access Denied" when uploading to S3
**Solution**: Check AWS credentials and bucket permissions (need `s3:PutObject`, `s3:DeleteObject`)

### Issue: Old Cloudinary URLs not deleting
**Solution**: Ensure Cloudinary environment variables are still set

### Issue: Images not publicly accessible
**Solution**: Check S3 bucket policy allows public read access, or update ACL in `aws.uploader.js`

## 📞 Next Steps

1. **Review the implementation** - all files are ready
2. **Install dependencies** - `npm install aws-sdk`
3. **Set environment variables** - Add AWS credentials
4. **Start migrating controllers** - Use unified service gradually
5. **Test thoroughly** - Verify both old and new URLs work

---

**Summary**: The migration is designed to be **zero-downtime** and **backward-compatible**. Old Cloudinary URLs continue to work while new uploads go to S3. The unified service automatically handles routing between providers.

