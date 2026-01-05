const QRCode = require('qrcode');

const generateQRCodeURL = async (text) => {
    try {
        // Generates a Data URL (base64 image)
        const qrCodeDataURL = await QRCode.toDataURL(text);
        return qrCodeDataURL;
    } catch (err) {
        console.error('QR code generation failed:', err);
        throw new Error('Failed to generate QR code');
    }
};

module.exports = { generateQRCodeURL };