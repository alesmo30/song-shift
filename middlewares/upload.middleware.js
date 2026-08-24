const multer = require('multer');

const { ValidationError } = require('../utils/errors');

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 5;

const fileFilter = (req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
        return;
    }

    cb(null, true);
};

const screenshotsUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES },
    fileFilter
}).array('screenshots', MAX_FILES);

const uploadMiddleware = (req, res, next) => {
    screenshotsUpload(req, res, (error) => {
        if (error instanceof multer.MulterError) {
            next(new ValidationError({ screenshots: error.message }));
            return;
        }

        if (error) {
            next(error);
            return;
        }

        if (!req.files || req.files.length === 0) {
            next(new ValidationError({ screenshots: 'At least one screenshot is required' }));
            return;
        }

        next();
    });
};

module.exports = uploadMiddleware;
