/**
 * Unified Multer Configuration
 * 
 * This multer configuration works for both Cloudinary and AWS S3.
 * Multer handles file upload to memory, and then the uploader services
 * (Cloudinary or S3) handle where to send the file.
 * 
 * Since both Cloudinary and S3 use the same multer setup (memory storage),
 * we use a single unified configuration.
 */

const multer = require('multer');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedFormats = ['image/jpeg', 'image/png', 'image/jpg'];
  if (allowedFormats.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only jpg, jpeg, and png formats are allowed'), false);
  }
};

const upload = multer({ storage, fileFilter });

module.exports = upload;

