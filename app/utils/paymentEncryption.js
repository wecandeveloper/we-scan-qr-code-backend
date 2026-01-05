const crypto = require('crypto');

// Get encryption key from environment variable
const ENCRYPTION_KEY = process.env.PAYMENT_ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const AUTH_TAG_LENGTH = 16; // 16 bytes for GCM

/**
 * Encrypt payment gateway keys before storing in database
 * @param {String} plainText - The plain text key to encrypt
 * @returns {String} - Encrypted string with format: "enc:iv:authTag:encryptedData"
 */
function encryptPaymentKey(plainText) {
    if (!plainText) {
        return null;
    }

    if (!ENCRYPTION_KEY) {
        throw new Error('PAYMENT_ENCRYPTION_KEY environment variable is not set');
    }

    // Ensure encryption key is 32 bytes (64 hex characters)
    let key;
    if (ENCRYPTION_KEY.length === 64) {
        // Already hex string, convert to buffer
        key = Buffer.from(ENCRYPTION_KEY, 'hex');
    } else if (ENCRYPTION_KEY.length === 32) {
        // Already 32 bytes, use directly
        key = Buffer.from(ENCRYPTION_KEY);
    } else {
        // Hash to get 32 bytes
        key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    }

    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Return format: "enc:iv:authTag:encryptedData"
    return `enc:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt payment gateway keys when needed for API calls
 * @param {String} encryptedText - The encrypted string with format: "enc:iv:authTag:encryptedData"
 * @returns {String} - Decrypted plain text key
 */
function decryptPaymentKey(encryptedText) {
    if (!encryptedText) {
        return null;
    }

    // If not encrypted format, return as is (for backward compatibility or plain text keys)
    if (!encryptedText.startsWith('enc:')) {
        return encryptedText;
    }

    if (!ENCRYPTION_KEY) {
        throw new Error('PAYMENT_ENCRYPTION_KEY environment variable is not set');
    }

    // Ensure encryption key is 32 bytes
    let key;
    if (ENCRYPTION_KEY.length === 64) {
        key = Buffer.from(ENCRYPTION_KEY, 'hex');
    } else if (ENCRYPTION_KEY.length === 32) {
        key = Buffer.from(ENCRYPTION_KEY);
    } else {
        key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    }

    // Parse encrypted string
    const parts = encryptedText.split(':');
    if (parts.length !== 4 || parts[0] !== 'enc') {
        throw new Error('Invalid encrypted format');
    }

    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encrypted = parts[3];

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Check if a string is encrypted
 * @param {String} text - The text to check
 * @returns {Boolean} - True if encrypted, false otherwise
 */
function isEncrypted(text) {
    return text && typeof text === 'string' && text.startsWith('enc:');
}

module.exports = {
    encryptPaymentKey,
    decryptPaymentKey,
    isEncrypted
};

