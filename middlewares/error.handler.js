const { AppError } = require('../utils/errors');

const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            status: 'error',
            message: err.message,
            ...(err.details && { errors: err.details })
        });
    }

    // Log unhandled server error
    logger.error('Unhandled Server Error:', err);

    const response = {
        status: 'error',
        message: 'Internal server error. Something went wrong.',
    };

    if (process.env.NODE_ENV === 'development') {
        response.error = err.message;
        response.stack = err.stack;
    }

    return res.status(500).json(response);
};

module.exports = {
    errorHandler
};
