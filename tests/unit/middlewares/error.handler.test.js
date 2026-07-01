const { errorHandler } = require('../../../middlewares/error.handler');
const { AppError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

jest.mock('../../../utils/logger');

describe('errorHandler middleware', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
        req = {};
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    test('should handle AppError correctly', () => {
        const error = new AppError('Custom error message', 400);

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Custom error message'
        });
    });

    test('should handle AppError with details correctly', () => {
        const details = { field: 'email', message: 'invalid email' };
        const error = new AppError('Validation failed', 422, details);

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(422);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Validation failed',
            errors: details
        });
    });

    test('should handle unknown errors in production environment', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        const error = new Error('Database connection failed');

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Internal server error. Something went wrong.'
        });
        expect(logger.error).toHaveBeenCalledWith('Unhandled Server Error:', error);

        process.env.NODE_ENV = originalEnv;
    });

    test('should handle unknown errors in development environment', () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const error = new Error('Database connection failed');
        error.stack = 'stack trace content';

        errorHandler(error, req, res, next);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Internal server error. Something went wrong.',
            error: 'Database connection failed',
            stack: 'stack trace content'
        });
        expect(logger.error).toHaveBeenCalledWith('Unhandled Server Error:', error);

        process.env.NODE_ENV = originalEnv;
    });
});
