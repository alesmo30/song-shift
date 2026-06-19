const { AppError } = require('../utils/errors');

const errorHandler = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            status: 'fail',
            message: err.message,
            errors: err.details
        });
    }

    // Log unhandled server error
    console.error('Unhandled Server Error:', err);

    return res.status(500).json({
        status: 'error',
        message: 'Internal server error. Something went wrong.',
        error: err.message || 'Internal server error. Something went wrong.'
    });
};

module.exports = {
    errorHandler
};
