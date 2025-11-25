# Migration Example: Updating a Controller

This shows how to migrate a controller from Cloudinary to the Unified Service.

## Example: Category Controller

### Before (Cloudinary Only)

```javascript
const { getBufferHash, findDuplicateImage, uploadImageBuffer, deleteCloudinaryImages } = require("../services/cloudinaryService/cloudinary.uploader");

categoryCtlr.create = async ({ body, file, user }) => {
    // ... existing code ...
    
    imageHash = getBufferHash(file.buffer);
    const duplicate = await findDuplicateImage(Category, imageHash, 'imageHash');
    
    if (duplicate) {
        imageUrl = duplicate.image;
        imagePublicId = duplicate.imagePublicId;
    } else {
        const uploaded = await uploadImageBuffer(file.buffer, Category, `${restaurant.folderKey}/Categories`);
        imageUrl = uploaded.secure_url;
        imagePublicId = uploaded.public_id;
    }
    
    // ... rest of code ...
};

categoryCtlr.delete = async ({ params: { categoryId } }) => {
    // ... existing code ...
    await deleteCloudinaryImages(category.imagePublicId);
    // ... rest of code ...
};
```

### After (Unified Service - Supports Both)

```javascript
// Change import
const { getBufferHash, findDuplicateImage, uploadImageBuffer, deleteImages } = require("../services/unifiedUploader/unified.uploader");

categoryCtlr.create = async ({ body, file, user }) => {
    // ... existing code (no changes needed) ...
    
    imageHash = getBufferHash(file.buffer);
    const duplicate = await findDuplicateImage(Category, imageHash, 'imageHash');
    
    if (duplicate) {
        imageUrl = duplicate.image;
        imagePublicId = duplicate.imagePublicId;
    } else {
        // This now uploads to S3 automatically
        const uploaded = await uploadImageBuffer(file.buffer, Category, `${restaurant.folderKey}/Categories`);
        imageUrl = uploaded.secure_url;
        imagePublicId = uploaded.key; // or uploaded.public_id (both work)
    }
    
    // ... rest of code ...
};

categoryCtlr.delete = async ({ params: { categoryId } }) => {
    // ... existing code ...
    // This automatically detects if it's Cloudinary or S3 URL/key
    await deleteImages(category.imagePublicId);
    // ... rest of code ...
};
```

## Key Changes

1. **Import Change**: 
   - `cloudinaryService/cloudinary.uploader` → `unifiedUploader/unified.uploader`

2. **Delete Function**:
   - `deleteCloudinaryImages()` → `deleteImages()`
   - Automatically handles both Cloudinary and S3

3. **Upload Functions**: 
   - Same function names, but now upload to S3
   - Return format is compatible (uses `secure_url` and `public_id`/`key`)

4. **No Breaking Changes**: 
   - Existing code structure remains the same
   - Database schema doesn't need changes
   - Old URLs continue to work

## Migration Pattern for All Controllers

1. Update import statement
2. Replace `deleteCloudinaryImages` with `deleteImages`
3. Test that new uploads go to S3
4. Test that old Cloudinary URLs still delete correctly

That's it! The unified service handles the rest automatically.

