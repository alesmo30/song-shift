const { AppError, ValidationError, AuthenticationError, AuthorizationError } = require('./errors');

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
});
