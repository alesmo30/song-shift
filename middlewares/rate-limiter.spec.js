const { AppError } = require('../utils/errors');

jest.mock('express-rate-limit', () => ({
    rateLimit: jest.fn((options) => ({ options }))
}));

describe('middlewares/rate-limiter', () => {
    const { authRateLimiter } = require('./rate-limiter');

    it('configures a 15 minute window capped at 10 requests per IP', () => {
        expect(authRateLimiter.options).toMatchObject({
            windowMs: 15 * 60 * 1000,
            max: 10,
            standardHeaders: true,
            legacyHeaders: false
        });
    });

    it('forwards a 429 AppError when the limit is exceeded', () => {
        const next = jest.fn();
        const options = { message: 'Too many login attempts from this IP, please try again after 15 minutes' };

        authRateLimiter.options.handler({}, {}, next, options);

        expect(next).toHaveBeenCalledTimes(1);
        const error = next.mock.calls[0][0];
        expect(error).toBeInstanceOf(AppError);
        expect(error.statusCode).toBe(429);
        expect(error.message).toBe(options.message);
    });
});
