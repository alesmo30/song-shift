const { rateLimit } = require('express-rate-limit');
const { AppError } = require('../utils/errors');

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many login attempts from this IP, please try again after 15 minutes',
    handler: (req, res, next, options) => {
        next(new AppError(options.message, 429));
    },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { authRateLimiter };
