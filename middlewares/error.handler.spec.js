const { errorHandler } = require('./error.handler');
const { AppError } = require('../utils/errors');
const logger = require('../utils/logger');

jest.mock('../utils/logger', () => ({
    error: jest.fn()
}));

describe('middlewares/error.handler', () => {
    const buildRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
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
});
