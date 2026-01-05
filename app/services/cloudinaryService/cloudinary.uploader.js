const cloudinary = require('../../config/cloudinary');
const crypto = require('crypto');

// Generate hash from image buffer
const getBufferHash = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

// Upload image from buffer to Cloudinary with optional model-based folder
const uploadImageBuffer = (fileBuffer, Model = null, customFolder = null) => {
    const modelName = Model?.modelName;
    const folder = customFolder || (modelName ? `We-QrCode/${modelName}` : 'We-QrCode');

    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder },
            (error, result) => {
                if (error) reject(error);
                else resolve(result);
            }
        );
        stream.end(fileBuffer);
    });
};


// Check if same image hash exists in any document (user, restaurant, etc.)
const findDuplicateImage = async (Model, imageHash, hashField = 'profilePicHash') => {
    if (!imageHash) return null;
    return await Model.findOne({ [hashField]: imageHash });
};

const processMultipleImageBuffers = async (files, Model = null, customFolder = null) => {
    const modelName = Model?.modelName;
    const folder = customFolder || (modelName ? `We-QrCode/${modelName}` : 'We-QrCode');

    const processedImages = [];

    for (const file of files) {
        const hash = getBufferHash(file.buffer);

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
                    publicId: existingImage.publicId,
                    hash: existingImage.hash
                });
                continue;
            }
        }

        // Upload new image if no duplicate found
        const uploaded = await uploadImageBuffer(file.buffer, Model, folder);

        processedImages.push({
            url: uploaded.secure_url,
            publicId: uploaded.public_id,
            hash
        });
    }

    return processedImages;
};

// Delete single or multiple images from Cloudinary
const deleteCloudinaryImages = async (publicIds = []) => {
    const ids = Array.isArray(publicIds) ? publicIds : [publicIds];
    for (const id of ids) {
        if (id) {
        await cloudinary.uploader.destroy(id);
        }
    }
};

module.exports = {
    getBufferHash,
    uploadImageBuffer,
    findDuplicateImage,
    deleteCloudinaryImages,
    processMultipleImageBuffers
};