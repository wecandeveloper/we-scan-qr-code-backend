const { s3, bucket, region } = require('../../config/aws');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Generate hash from image buffer (same as Cloudinary)
const getBufferHash = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

// Generate S3 key from folder and filename
const generateS3Key = (folder, filename) => {
    const sanitizedFolder = folder ? folder.replace(/\/+/g, '/').replace(/^\/|\/$/g, '') : '';
    const sanitizedFilename = filename || `${uuidv4()}.jpg`;
    return sanitizedFolder ? `${sanitizedFolder}/${sanitizedFilename}` : sanitizedFilename;
};

// Get S3 URL from key
const getS3Url = (key) => {
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
};

// Extract S3 key from URL
const extractS3KeyFromUrl = (url) => {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        // Handle both formats: bucket.s3.region.amazonaws.com/key or s3.region.amazonaws.com/bucket/key
        if (urlObj.hostname.includes('s3') && urlObj.hostname.includes('amazonaws.com')) {
            return urlObj.pathname.substring(1); // Remove leading slash
        }
        return null;
    } catch (error) {
        return null;
    }
};

// Upload image from buffer to S3 with optional model-based folder
const uploadImageBuffer = async (fileBuffer, Model = null, customFolder = null, mimetype = 'image/jpeg') => {
    // Validate AWS configuration
    if (!bucket) {
        throw new Error('AWS_S3_BUCKET environment variable is not set');
    }
    if (!s3.config.credentials) {
        throw new Error('AWS credentials are not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY');
    }

    const modelName = Model?.modelName;
    const folder = customFolder || (modelName ? `We-QrCode/${modelName}` : 'We-QrCode');
    
    // Generate unique filename
    const extension = mimetype.split('/')[1] || 'jpg';
    const filename = `${uuidv4()}.${extension}`;
    const key = generateS3Key(folder, filename);

    const params = {
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: mimetype
        // Note: ACL removed - modern S3 buckets use bucket policies for access control
        // Make sure your bucket policy allows public read access if needed
    };

    try {
        const data = await s3.upload(params).promise();
        
        // Return format similar to Cloudinary response
        return {
            secure_url: data.Location,
            url: data.Location,
            public_id: key, // Use S3 key as public_id equivalent
            key: key,
            etag: data.ETag
        };
    } catch (error) {
        throw new Error(`S3 upload failed: ${error.message}`);
    }
};

// Check if same image hash exists in any document (same as Cloudinary)
const findDuplicateImage = async (Model, imageHash, hashField = 'profilePicHash') => {
    if (!imageHash) return null;
    return await Model.findOne({ [hashField]: imageHash });
};

// Process multiple image buffers with duplicate checking
const processMultipleImageBuffers = async (files, Model = null, customFolder = null) => {
    const modelName = Model?.modelName;
    const folder = customFolder || (modelName ? `We-QrCode/${modelName}` : 'We-QrCode');

    const processedImages = [];

    for (const file of files) {
        const hash = getBufferHash(file.buffer);
        const mimetype = file.mimetype || 'image/jpeg';

        // Only check for duplicate if Model is provided
        let duplicate = null;
        if (Model) {
            duplicate = await findDuplicateImage(Model, hash, 'images.hash');
        }

        if (duplicate) {
            // Reuse existing image data when duplicate is found
            const existingImage = duplicate.images.find(img => img.hash === hash);
            if (existingImage) {
                processedImages.push({
                    url: existingImage.url,
                    publicId: existingImage.publicId, // Keep publicId field for compatibility
                    key: existingImage.key || existingImage.publicId, // Add key field
                    hash: existingImage.hash
                });
                continue;
            }
        }

        // Upload new image if no duplicate found
        const uploaded = await uploadImageBuffer(file.buffer, Model, folder, mimetype);

        processedImages.push({
            url: uploaded.secure_url,
            publicId: uploaded.key, // Store S3 key as publicId for compatibility
            key: uploaded.key,
            hash
        });
    }

    return processedImages;
};

// Delete single or multiple images from S3
const deleteS3Images = async (keys = []) => {
    const keyArray = Array.isArray(keys) ? keys : [keys];
    
    for (const key of keyArray) {
        if (!key) continue;
        
        // If key is a URL, extract the key from it
        const s3Key = key.includes('amazonaws.com') ? extractS3KeyFromUrl(key) : key;
        
        if (!s3Key) {
            console.warn(`Invalid S3 key/URL: ${key}`);
            continue;
        }

        try {
            await s3.deleteObject({
                Bucket: bucket,
                Key: s3Key
            }).promise();
        } catch (error) {
            console.error(`Failed to delete S3 object ${s3Key}:`, error.message);
            // Don't throw - continue with other deletions
        }
    }
};

// Helper function to detect if URL is from Cloudinary or S3
const detectProvider = (url) => {
    if (!url) return null;
    if (url.includes('cloudinary.com')) return 'cloudinary';
    if (url.includes('amazonaws.com') || url.includes('s3.')) return 's3';
    return null;
};

module.exports = {
    getBufferHash,
    uploadImageBuffer,
    findDuplicateImage,
    deleteS3Images,
    processMultipleImageBuffers,
    getS3Url,
    extractS3KeyFromUrl,
    detectProvider
};

