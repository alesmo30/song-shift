const { AppError, ValidationError, AuthenticationError, AuthorizationError, NotFoundError, RateLimitError, ExternalServiceError } = require('./errors');

describe('utils/errors', () => {
    describe('AppError', () => {
        it('sets message, default statusCode, null details, and isOperational', () => {
            const error = new AppError('Something broke');

            expect(error.message).toBe('Something broke');
            expect(error.statusCode).toBe(500);
            expect(error.details).toBeNull();
            expect(error.isOperational).toBe(true);
            expect(error).toBeInstanceOf(Error);
        });

        it('accepts a custom statusCode and details', () => {
            const details = { field: 'invalid' };
            const error = new AppError('Bad input', 400, details);

            expect(error.statusCode).toBe(400);
            expect(error.details).toBe(details);
        });
    });

    describe('ValidationError', () => {
        it('is a 400 AppError named ValidationError carrying details', () => {
            const details = { email: 'is required' };
            const error = new ValidationError(details);

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('ValidationError');
            expect(error.message).toBe('Validation Error');
            expect(error.statusCode).toBe(400);
            expect(error.details).toBe(details);
        });
    });

    describe('AuthenticationError', () => {
        it('defaults to a 401 AppError named AuthenticationError', () => {
            const error = new AuthenticationError();

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('AuthenticationError');
            expect(error.message).toBe('Authentication Error');
            expect(error.statusCode).toBe(401);
        });

        it('accepts a custom message', () => {
            const error = new AuthenticationError('Invalid email or password');

            expect(error.message).toBe('Invalid email or password');
            expect(error.statusCode).toBe(401);
        });
    });

    describe('AuthorizationError', () => {
        it('defaults to a 403 AppError named AuthorizationError', () => {
            const error = new AuthorizationError();

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('AuthorizationError');
            expect(error.message).toBe('Authorization Error');
            expect(error.statusCode).toBe(403);
        });

        it('accepts a custom message', () => {
            const error = new AuthorizationError('You do not have permission to perform this action');

            expect(error.message).toBe('You do not have permission to perform this action');
            expect(error.statusCode).toBe(403);
        });
    });

    describe('NotFoundError', () => {
        it('defaults to a 404 AppError named NotFoundError', () => {
            const error = new NotFoundError();

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('NotFoundError');
            expect(error.message).toBe('Not Found');
            expect(error.statusCode).toBe(404);
        });

        it('accepts a custom message', () => {
            const error = new NotFoundError('Playlist not found');

            expect(error.message).toBe('Playlist not found');
            expect(error.statusCode).toBe(404);
        });
    });

    describe('RateLimitError', () => {
        it('defaults message and retryAfter when called with no arguments', () => {
            const error = new RateLimitError();

            expect(error.message).toBe('Rate limit exceeded');
            expect(error.statusCode).toBe(429);
            expect(error.retryAfter).toBeUndefined();
        });

        it('defaults to a 429 AppError named RateLimitError carrying retryAfter', () => {
            const error = new RateLimitError('Rate limit exceeded', 5);

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('RateLimitError');
            expect(error.message).toBe('Rate limit exceeded');
            expect(error.statusCode).toBe(429);
            expect(error.retryAfter).toBe(5);
            expect(error.details).toEqual({ retryAfter: 5 });
        });

        it('accepts a custom message', () => {
            const error = new RateLimitError('Too many requests', 10);

            expect(error.message).toBe('Too many requests');
            expect(error.retryAfter).toBe(10);
        });
    });

    describe('ExternalServiceError', () => {
        it('defaults to a 502 AppError named ExternalServiceError', () => {
            const error = new ExternalServiceError();

            expect(error).toBeInstanceOf(AppError);
            expect(error.name).toBe('ExternalServiceError');
            expect(error.message).toBe('External service is unavailable');
            expect(error.statusCode).toBe(502);
        });

        it('accepts a custom message', () => {
            const error = new ExternalServiceError('Spotify is unavailable');

            expect(error.message).toBe('Spotify is unavailable');
            expect(error.statusCode).toBe(502);
        });
    });
});
