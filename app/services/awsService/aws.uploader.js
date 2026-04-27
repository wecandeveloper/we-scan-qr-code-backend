const { s3, bucket, cdnBaseUrl, endpointHost } = require('../../config/aws');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const skipObjectAcl = ['none', 'false', '0'].includes(
    String(process.env.DO_SPACES_OBJECT_ACL || '').toLowerCase()
);

/** Public URL for an object key (CDN when configured, else virtual-hosted Spaces URL). */
const buildPublicObjectUrl = (key) => {
    if (!key) return '';
    const encodedKey = key
        .split('/')
        .map((seg) => encodeURIComponent(seg))
        .join('/');
    if (cdnBaseUrl) {
        return `${cdnBaseUrl.replace(/\/+$/, '')}/${encodedKey}`;
    }
    if (bucket && endpointHost) {
        return `https://${bucket}.${endpointHost}/${encodedKey}`;
    }
    return encodedKey;
};

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

// Get public URL from object key (CDN-first)
const getS3Url = (key) => {
    return buildPublicObjectUrl(key);
};

/**
 * Extract object key from a stored URL (AWS S3, DigitalOcean Spaces, or CDN origin).
 */
const extractS3KeyFromUrl = (url) => {
    if (!url) return null;
    const trimmed = String(url).trim();
    try {
        const noQuery = trimmed.split('?')[0];
        const base = (cdnBaseUrl || '').replace(/\/+$/, '');
        if (base && (noQuery === base || noQuery.startsWith(`${base}/`))) {
            const rest = noQuery.slice(base.length).replace(/^\//, '');
            return rest || null;
        }

        const urlObj = new URL(trimmed);
        const host = urlObj.hostname.toLowerCase();
        let path = (urlObj.pathname || '/').replace(/^\/+/, '');

        if (host.endsWith('.digitaloceanspaces.com')) {
            const hostParts = host.split('.');
            // Path-style: {region}.digitaloceanspaces.com/{bucket}/{key...}
            if (hostParts.length === 3) {
                const segs = path.split('/').filter(Boolean);
                if (segs.length >= 2) {
                    return segs.slice(1).join('/');
                }
                return segs[0] || null;
            }
            // Virtual-hosted: {bucket}.{region}.digitaloceanspaces.com/{key...}
            return path || null;
        }

        if (host.includes('amazonaws.com') && host.includes('s3')) {
            const pathStyleHost =
                /^s3[.-][a-z0-9-]+\.amazonaws\.com$/i.test(host) ||
                /^s3\.amazonaws\.com$/i.test(host);
            if (pathStyleHost) {
                const segs = path.split('/').filter(Boolean);
                if (segs.length >= 2) {
                    return segs.slice(1).join('/');
                }
                return segs[0] || null;
            }
            return path || null;
        }

        return null;
    } catch (error) {
        return null;
    }
};

// Upload image from buffer to Spaces with optional model-based folder
const uploadImageBuffer = async (fileBuffer, Model = null, customFolder = null, mimetype = 'image/jpeg') => {
    if (!bucket) {
        throw new Error('DO_SPACES_BUCKET environment variable is not set');
    }
    if (!endpointHost) {
        throw new Error('DO_SPACES_ENDPOINT environment variable is not set (e.g. nyc3.digitaloceanspaces.com)');
    }
    if (!s3.config.credentials || !s3.config.credentials.accessKeyId) {
        throw new Error(
            'Spaces credentials are not configured. Please set DO_SPACES_KEY and DO_SPACES_SECRET'
        );
    }

    const modelName = Model?.modelName;
    const folder = customFolder || (modelName ? `We-QrCode/${modelName}` : 'We-QrCode');

    const extension = mimetype.split('/')[1] || 'jpg';
    const filename = `${uuidv4()}.${extension}`;
    const key = generateS3Key(folder, filename);

    const params = {
        Bucket: bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: mimetype
    };
    if (!skipObjectAcl) {
        params.ACL = 'public-read';
    }

    try {
        const data = await s3.upload(params).promise();
        const location = buildPublicObjectUrl(key);

        return {
            secure_url: location,
            url: location,
            public_id: key,
            key: key,
            etag: data.ETag
        };
    } catch (error) {
        if (!skipObjectAcl && error.code === 'AccessControlListNotSupported') {
            throw new Error(
                `Spaces upload failed (ACL not supported on this Space): ${error.message}. Set DO_SPACES_OBJECT_ACL=none and use a bucket policy for public reads.`
            );
        }
        throw new Error(`Spaces upload failed: ${error.message}`);
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

        let duplicate = null;
        if (Model) {
            duplicate = await findDuplicateImage(Model, hash, 'images.hash');
        }

        if (duplicate) {
            const existingImage = duplicate.images.find((img) => img.hash === hash);
            if (existingImage) {
                processedImages.push({
                    url: existingImage.url,
                    publicId: existingImage.publicId,
                    key: existingImage.key || existingImage.publicId,
                    hash: existingImage.hash
                });
                continue;
            }
        }

        const uploaded = await uploadImageBuffer(file.buffer, Model, folder, mimetype);

        processedImages.push({
            url: uploaded.secure_url,
            publicId: uploaded.key,
            key: uploaded.key,
            hash
        });
    }

    return processedImages;
};

const deleteS3Images = async (keys = []) => {
    const keyArray = Array.isArray(keys) ? keys : [keys];

    for (const key of keyArray) {
        if (!key) continue;

        const isHttpUrl = /^https?:\/\//i.test(String(key).trim());
        const s3Key = isHttpUrl ? extractS3KeyFromUrl(key) : key;

        if (!s3Key) {
            console.warn(`Invalid Spaces key/URL: ${key}`);
            continue;
        }

        try {
            await s3
                .deleteObject({
                    Bucket: bucket,
                    Key: s3Key
                })
                .promise();
        } catch (error) {
            console.error(`Failed to delete Spaces object ${s3Key}:`, error.message);
        }
    }
};

const detectProvider = (url) => {
    if (!url) return null;
    if (url.includes('cloudinary.com')) return 'cloudinary';
    if (url.includes('amazonaws.com') || url.includes('s3.')) return 's3';
    if (url.includes('digitaloceanspaces.com')) return 's3';
    const base = (cdnBaseUrl || '').replace(/\/+$/, '');
    if (base && url.startsWith(base)) return 's3';
    return null;
};

/**
 * Presigned GET URL for private objects (optional; public assets use CDN URL).
 * @param {string} key - Object key
 * @param {number} [expiresSeconds=300]
 * @returns {string}
 */
const getSignedGetObjectUrl = (key, expiresSeconds = 300) => {
    if (!key) throw new Error('Object key is required');
    if (!bucket) throw new Error('DO_SPACES_BUCKET is not set');
    return s3.getSignedUrl('getObject', {
        Bucket: bucket,
        Key: key,
        Expires: expiresSeconds
    });
};

module.exports = {
    getBufferHash,
    uploadImageBuffer,
    findDuplicateImage,
    deleteS3Images,
    processMultipleImageBuffers,
    getS3Url,
    extractS3KeyFromUrl,
    detectProvider,
    getSignedGetObjectUrl
};
