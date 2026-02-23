/**
 * Unified Uploader Service
 *
 * Uses AWS S3 for all uploads and deletes.
 * Cloudinary URLs are skipped on delete (migration complete; remaining refs are 404).
 */

const awsService = require('../awsService/aws.uploader');

/**
 * Detect provider from URL
 * @param {string} url - Image URL
 * @returns {string|null} - 'cloudinary', 's3', or null
 */
const detectProvider = (url) => {
    if (!url) return null;
    if (url.includes('cloudinary.com')) return 'cloudinary';
    if (url.includes('amazonaws.com') || url.includes('s3.')) return 's3';
    return null;
};

/**
 * Detect provider from publicId/key
 * @param {string} publicId - Public ID or S3 key
 * @returns {string} - 'cloudinary' or 's3'
 */
const detectProviderFromKey = (publicId) => {
    if (!publicId) return 's3'; // Default to S3 for new uploads
    // Cloudinary publicIds typically don't have slashes at start or are in format "folder/filename"
    // S3 keys are typically longer paths
    // For safety, if it's not clearly Cloudinary format, assume S3
    return 's3'; // Default to S3 for new uploads
};

/**
 * Unified upload image buffer
 * Always uploads to S3 (new provider)
 */
const uploadImageBuffer = async (fileBuffer, Model = null, customFolder = null, mimetype = 'image/jpeg') => {
    // Always use S3 for new uploads
    return await awsService.uploadImageBuffer(fileBuffer, Model, customFolder, mimetype);
};

/**
 * Unified process multiple image buffers
 * Always uploads to S3 (new provider)
 */
const processMultipleImageBuffers = async (files, Model = null, customFolder = null) => {
    // Always use S3 for new uploads
    return await awsService.processMultipleImageBuffers(files, Model, customFolder);
};

/**
 * Unified delete images
 * Routes S3 URLs/keys to AWS; skips Cloudinary URLs (no-op, migration complete)
 */
const deleteImages = async (publicIdsOrUrls = []) => {
    const items = Array.isArray(publicIdsOrUrls) ? publicIdsOrUrls : [publicIdsOrUrls];
    const s3Items = [];

    for (const item of items) {
        if (!item) continue;

        const provider = detectProvider(item);

        if (provider === 'cloudinary') {
            // No-op: migration complete; remaining Cloudinary refs are 404
            continue;
        }
        if (provider === 's3') {
            s3Items.push(item);
            continue;
        }

        // Not a URL - treat as publicId/key
        const hasFileExtension = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(item);
        const hasUuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(item);

        if (hasFileExtension || hasUuidPattern || item.length > 60) {
            s3Items.push(item);
        }
        // Else: likely old Cloudinary publicId - skip (no-op)
    }

    if (s3Items.length > 0) {
        await awsService.deleteS3Images(s3Items);
    }
};

/**
 * Unified delete by extracting from document URLs
 * Useful when you have documents with image URLs and need to delete them
 */
const deleteImagesFromUrls = async (urls = []) => {
    const urlArray = Array.isArray(urls) ? urls : [urls];
    await deleteImages(urlArray);
};

const getBufferHash = awsService.getBufferHash;
const findDuplicateImage = awsService.findDuplicateImage;

module.exports = {
    uploadImageBuffer,
    processMultipleImageBuffers,
    deleteImages,
    deleteImagesFromUrls,
    getBufferHash,
    findDuplicateImage,
    detectProvider,
    aws: awsService
};

