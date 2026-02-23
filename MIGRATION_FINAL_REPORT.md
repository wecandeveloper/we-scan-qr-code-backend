# Cloudinary to S3 Migration - Final Report

## 1. Target S3 Folder Structure (from attachment)

```
We-QrCode/
├── Category/
├── Product/
├── Restaurant/
└── User/
```

All assets organized by entity type only. No restaurant-slug subfolders.

---

## 2. Current Configurations

### 2.1 AWS config

| File | Purpose |
|------|---------|
| `app/config/aws.js` | S3 client, bucket, region from env vars |

**Env vars used:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`

### 2.2 AWS uploader

| File | Key logic |
|------|-----------|
| `app/services/awsService/aws.uploader.js` | `uploadImageBuffer`, `processMultipleImageBuffers` use `customFolder` or `We-QrCode/${Model.modelName}` |

**Fallback when no customFolder:** `We-QrCode/User`, `We-QrCode/Restaurant`, etc. (from Model name)

### 2.3 Unified uploader

| File | Purpose |
|------|---------|
| `app/services/unifiedUploader/unified.uploader.js` | Forwards to AWS for uploads; detects Cloudinary vs S3 for deletes |

### 2.4 Migration script

| File | Folder logic |
|------|--------------|
| `scripts/migrate-cloudinary-to-s3.js` | `getFolderForCollection`: User→`We-QrCode/User`, Restaurant→`We-QrCode/Restaurant`, Product→`We-QrCode/Product`, Category→`We-QrCode/Category` |

**Migration script:** Already uses target structure.

---

## 3. Current vs Target Folder Structure

| Entity | Current folder pattern | Target folder |
|--------|-------------------------|---------------|
| User | `We-QrCode/User` | `We-QrCode/User` |
| Restaurant (create) | `We-QrCode/{slug}/Gallery`, `.../Logos`, `.../FavIcons`, `.../Banners`, `.../Offer-Banners`, `.../Qr-Code` | `We-QrCode/Restaurant` |
| Restaurant (update) | `We-QrCode/{folderKey}/Gallery`, etc. (folderKey = We-QrCode/{slug}) | `We-QrCode/Restaurant` |
| Product | `We-QrCode/{restaurant.folderKey}/Products` | `We-QrCode/Product` |
| Category | `We-QrCode/{restaurant.folderKey}/Categories` | `We-QrCode/Category` |

**Compliance:** User matches. Restaurant, Product, and Category use `We-QrCode/{slug}/...` and need to be switched to `We-QrCode/{Entity}/`.

---

## 4. Files to Modify

### 4.1 `app/controllers/restaurant.controller.js`

**Create restaurant (around lines 161–262)**  
Current folders use `restaurantFolder = We-QrCode/${slug}`.

| Line | Current | Required |
|------|---------|----------|
| 162 | `const restaurantFolder = \`We-QrCode/${slug}\`;` | `const restaurantFolder = 'We-QrCode/Restaurant';` |
| 165 | `${restaurantFolder}/Gallery` | `We-QrCode/Restaurant` (or `${restaurantFolder}` for gallery) |
| 171 | `${restaurantFolder}/Logos` | `We-QrCode/Restaurant` |
| 183 | `${restaurantFolder}/FavIcons` | `We-QrCode/Restaurant` |
| 194 | `${restaurantFolder}/Banners` | `We-QrCode/Restaurant` |
| 200 | `${restaurantFolder}/Offer-Banners` | `We-QrCode/Restaurant` |
| 262 | `${restaurant.folderKey}/Qr-Code` | `We-QrCode/Restaurant` |

All restaurant uploads should use `We-QrCode/Restaurant` as the folder.

**Update restaurant (around lines 454, 473–696)**  
Uses `existingRestaurant.folderKey` for image folders.

| Line | Current | Required |
|------|---------|----------|
| 454 | `folderKey: existingRestaurant.folderKey \|\| \`We-QrCode/${slug}\` \` | `folderKey: 'We-QrCode/Restaurant'` (or remove if unused) |
| 516 | `${existingRestaurant.folderKey}/Gallery` | `We-QrCode/Restaurant` |
| 525 | `${existingRestaurant.folderKey}/Banners` | `We-QrCode/Restaurant` |
| 531 | `${existingRestaurant.folderKey}/Offer-Banners` | `We-QrCode/Restaurant` |
| 544 | `${existingRestaurant.folderKey}/Logos` | `We-QrCode/Restaurant` |
| 564 | `${existingRestaurant.folderKey}/FavIcons` | `We-QrCode/Restaurant` |
| 696 | `${existingRestaurant.folderKey}/Qr-Code` | `We-QrCode/Restaurant` |

**Create flow:**  
Replace `restaurantFolder` usage with `'We-QrCode/Restaurant'` and set:

```javascript
folderKey: 'We-QrCode/Restaurant',
```

**Update flow:**  
Replace all `existingRestaurant.folderKey`-based folder paths with `'We-QrCode/Restaurant'`.

---

### 4.2 `app/controllers/product.controller.js`

**Create product (around line 56)**  
Current: `processMultipleImageBuffers(files, Product, \`${restaurant.folderKey}/Products\`)`  

**Required:** `processMultipleImageBuffers(files, Product, 'We-QrCode/Product')`

**Update product (around line 386)**  
Current: `processMultipleImageBuffers(files, Product, \`${restaurant.folderKey}/Products\`)`  

**Required:** `processMultipleImageBuffers(files, Product, 'We-QrCode/Product')`

---

### 4.3 `app/controllers/category.controller.js`

**Create category (around line 36)**  
Current: `uploadImageBuffer(file.buffer, Category, \`${restaurant.folderKey}/Categories\`)`  

**Required:** `uploadImageBuffer(file.buffer, Category, 'We-QrCode/Category')`

**Update category (around line 180)**  
Current: `uploadImageBuffer(file.buffer, Category, \`${restaurant.folderKey}/Categories\`)`  

**Required:** `uploadImageBuffer(file.buffer, Category, 'We-QrCode/Category')`

---

### 4.4 `app/models/restaurant.model.js`

| Line | Current | Note |
|------|---------|------|
| 12 | `folderKey: String` | Optional: keep for compatibility or remove if not needed. Controllers will no longer use it for S3 paths. |

No change required if you only update controller logic and keep `folderKey` for backward compatibility.

---

## 5. Summary of Required Changes

| File | Changes |
|------|---------|
| `app/controllers/restaurant.controller.js` | Replace all `We-QrCode/${slug}` and `existingRestaurant.folderKey` folder paths with `'We-QrCode/Restaurant'` for gallery, logos, favicons, banners, offer banners, QR code. Set `folderKey: 'We-QrCode/Restaurant'` on create/update. |
| `app/controllers/product.controller.js` | Replace `${restaurant.folderKey}/Products` with `'We-QrCode/Product'` in create and update handlers. |
| `app/controllers/category.controller.js` | Replace `${restaurant.folderKey}/Categories` with `'We-QrCode/Category'` in create and update handlers. |

---

## 6. No Changes Required

| File | Reason |
|------|--------|
| `app/config/aws.js` | Config is correct. |
| `app/services/awsService/aws.uploader.js` | Uses `customFolder`; controllers pass the correct folder. |
| `app/services/unifiedUploader/unified.uploader.js` | Pass-through; no folder logic. |
| `scripts/migrate-cloudinary-to-s3.js` | Already uses target folder structure. |
| `scripts/audit-cloudinary-assets.js` | Audit only; no upload paths. |

---

## 7. S3 Bucket Policy

Current policy already allows `We-QrCode/*`:

```json
"Resource": "arn:aws:s3:::dineos-bucket/We-QrCode/*"
```

No change needed.

---

## 8. Verification Checklist

- [ ] Restaurant create uploads to `We-QrCode/Restaurant/`
- [ ] Restaurant update uploads to `We-QrCode/Restaurant/`
- [ ] Product create/update uploads to `We-QrCode/Product/`
- [ ] Category create/update uploads to `We-QrCode/Category/`
- [ ] User uploads remain in `We-QrCode/User/` (unchanged)
- [ ] S3 bucket shows `Category/`, `Product/`, `Restaurant/`, `User/` under `We-QrCode/`
- [ ] Existing migrated assets already in target structure; new uploads will match.
