/**
 * Unified Uploader Service
 * 
 * This service provides a unified interface for both Cloudinary and AWS S3.
 * It automatically detects which provider to use based on URLs and routes operations accordingly.
 * 
 * Migration Strategy:
 * - New uploads go to AWS S3
 * - Old Cloudinary URLs are still supported for deletion/operations
 * - Use this service instead of direct Cloudinary/S3 calls for seamless migration
 */

const cloudinaryService = require('../cloudinaryService/cloudinary.uploader');
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
 * Automatically detects provider from URL/key and routes to appropriate service
 */
const deleteImages = async (publicIdsOrUrls = []) => {
    const items = Array.isArray(publicIdsOrUrls) ? publicIdsOrUrls : [publicIdsOrUrls];
    
    const cloudinaryItems = [];
    const s3Items = [];

    for (const item of items) {
        if (!item) continue;

        // Check if it's a URL
        const provider = detectProvider(item);
        
        if (provider === 'cloudinary') {
            cloudinaryItems.push(item);
        } else if (provider === 's3') {
            s3Items.push(item);
        } else {
            // If it's not a URL, it might be a publicId/key
            // Heuristic: S3 keys often have file extensions (.jpg, .png) and UUIDs
            // Cloudinary publicIds typically don't have extensions and are shorter
            // For safety with old data, default to Cloudinary if uncertain
            const hasFileExtension = /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(item);
            const hasUuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(item);
            
            if (hasFileExtension || hasUuidPattern || item.length > 60) {
                // Likely S3 key (has extension or UUID pattern or very long)
                s3Items.push(item);
            } else {
                // Likely Cloudinary publicId (no extension, shorter, older format)
                cloudinaryItems.push(item);
            }
        }
    }

    // Delete from both providers if needed
    const promises = [];
    if (cloudinaryItems.length > 0) {
        promises.push(cloudinaryService.deleteCloudinaryImages(cloudinaryItems));
    }
    if (s3Items.length > 0) {
        promises.push(awsService.deleteS3Images(s3Items));
    }

    await Promise.all(promises);
};

/**
 * Unified delete by extracting from document URLs
 * Useful when you have documents with image URLs and need to delete them
 */
const deleteImagesFromUrls = async (urls = []) => {
    const urlArray = Array.isArray(urls) ? urls : [urls];
    await deleteImages(urlArray);
};

/**
 * Get buffer hash (same for both providers)
 */
const getBufferHash = cloudinaryService.getBufferHash;

/**
 * Find duplicate image (same for both providers - checks database)
 */
const findDuplicateImage = cloudinaryService.findDuplicateImage;

module.exports = {
    // Upload functions (always use S3)
    uploadImageBuffer,
    processMultipleImageBuffers,
    
    // Delete functions (auto-detect provider)
    deleteImages,
    deleteImagesFromUrls,
    
    // Utility functions
    getBufferHash,
    findDuplicateImage,
    detectProvider,
    
    // Direct access to providers (for edge cases)
    cloudinary: cloudinaryService,
    aws: awsService
};

