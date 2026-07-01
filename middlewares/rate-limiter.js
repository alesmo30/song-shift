const { rateLimit } = require('express-rate-limit');
const { AppError } = require('../utils/errors');

const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
    message: 'Too many login attempts from this IP, please try again after 15 minutes',
    handler: (req, res, next, options) => {
        next(new AppError(options.message, 429));
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

module.exports = { authRateLimiter };
