const { loginSchemaValidation } = require('./login-schema.validation');
const { ValidationError } = require('../utils/errors');

describe('middlewares/login-schema.validation', () => {
    const buildReq = (body) => ({ body });

    it('calls next and coerces req.body when the payload is valid', () => {
        const req = buildReq({ email: 'user@example.com', password: 'secret123' });
        const next = jest.fn();

        loginSchemaValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ email: 'user@example.com', password: 'secret123' });
    });

    it('throws a ValidationError when email is missing', () => {
        const req = buildReq({ password: 'secret123' });

        expect(() => loginSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when email is not a valid email', () => {
        const req = buildReq({ email: 'not-an-email', password: 'secret123' });

        expect(() => loginSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError with formatted details when password exceeds the max length', () => {
        const req = buildReq({ email: 'user@example.com', password: 'a'.repeat(129) });

        try {
            loginSchemaValidation(req, {}, jest.fn());
            throw new Error('expected loginSchemaValidation to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.details).toHaveProperty('password');
        }
    });

    it('throws a ValidationError aggregating multiple field errors', () => {
        const req = buildReq({ email: 'not-an-email' });

        try {
            loginSchemaValidation(req, {}, jest.fn());
            throw new Error('expected loginSchemaValidation to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.details).toHaveProperty('email');
            expect(error.details).toHaveProperty('password');
        }
    });
});
