const { errorHandler } = require('./error.handler');
const { AppError, RateLimitError } = require('../utils/errors');
const logger = require('../utils/logger');

jest.mock('../utils/logger', () => ({
    error: jest.fn()
}));

describe('middlewares/error.handler', () => {
    const buildRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        res.set = jest.fn().mockReturnValue(res);
        return res;
    };

    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    it('responds with the AppError statusCode and message', () => {
        const res = buildRes();
        const error = new AppError('Bad request', 400);

        errorHandler(error, {}, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Bad request'
        });
    });

    it('includes details in the response when the AppError carries them', () => {
        const res = buildRes();
        const details = { email: 'is required' };
        const error = new AppError('Validation Error', 400, details);

        errorHandler(error, {}, res, jest.fn());

        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Validation Error',
            errors: details
        });
    });

    it('logs and responds 500 for a non-AppError in production', () => {
        process.env.NODE_ENV = 'production';
        const res = buildRes();
        const error = new Error('Unexpected failure');

        errorHandler(error, {}, res, jest.fn());

        expect(logger.error).toHaveBeenCalledWith('Unhandled Server Error:', error);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            status: 'error',
            message: 'Internal server error. Something went wrong.'
        });
    });

    it('includes error message and stack for a non-AppError in development', () => {
        process.env.NODE_ENV = 'development';
        const res = buildRes();
        const error = new Error('Unexpected failure');

        errorHandler(error, {}, res, jest.fn());

        expect(res.status).toHaveBeenCalledWith(500);
        const payload = res.json.mock.calls[0][0];
        expect(payload.status).toBe('error');
        expect(payload.error).toBe('Unexpected failure');
        expect(payload.stack).toBe(error.stack);
    });

    it('sets the Retry-After header for a RateLimitError with retryAfter', () => {
        const res = buildRes();
        const error = new RateLimitError('Rate limit exceeded', 5);

        errorHandler(error, {}, res, jest.fn());

        expect(res.set).toHaveBeenCalledWith('Retry-After', '5');
        expect(res.status).toHaveBeenCalledWith(429);
    });

    it('does not set Retry-After for a RateLimitError without retryAfter', () => {
        const res = buildRes();
        const error = new RateLimitError('Rate limit exceeded');

        errorHandler(error, {}, res, jest.fn());

        expect(res.set).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(429);
    });

    it('does not set Retry-After for a non-RateLimitError AppError', () => {
        const res = buildRes();
        const error = new AppError('Bad request', 400);

        errorHandler(error, {}, res, jest.fn());

        expect(res.set).not.toHaveBeenCalled();
    });
});
