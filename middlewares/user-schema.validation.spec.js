const { userSchemaValidation } = require('./user-schema.validation');
const { ValidationError } = require('../utils/errors');

describe('middlewares/user-schema.validation', () => {
    const buildReq = (body) => ({ body });
    const validPayload = {
        name: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        password: 'secret123'
    };

    it('calls next and coerces req.body when the payload is valid', () => {
        const req = buildReq(validPayload);
        const next = jest.fn();

        userSchemaValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toMatchObject(validPayload);
    });

    it('defaults role to USER when not provided', () => {
        const req = buildReq(validPayload);

        userSchemaValidation(req, {}, jest.fn());

        expect(req.body.role).toBe('USER');
    });

    it('accepts an explicit ADMIN role', () => {
        const req = buildReq({ ...validPayload, role: 'ADMIN' });

        userSchemaValidation(req, {}, jest.fn());

        expect(req.body.role).toBe('ADMIN');
    });

    it('throws a ValidationError for an invalid role value', () => {
        const req = buildReq({ ...validPayload, role: 'SUPERADMIN' });

        expect(() => userSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when a required field is missing', () => {
        const { name, ...rest } = validPayload;
        const req = buildReq(rest);

        expect(() => userSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when password is shorter than the minimum length', () => {
        const req = buildReq({ ...validPayload, password: 'ab' });

        expect(() => userSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when password exceeds the maximum length', () => {
        const req = buildReq({ ...validPayload, password: 'a'.repeat(129) });

        expect(() => userSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when email is not a valid email', () => {
        const req = buildReq({ ...validPayload, email: 'not-an-email' });

        expect(() => userSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError with formatted details for multiple invalid fields', () => {
        const req = buildReq({ ...validPayload, name: 'J', email: 'not-an-email' });

        try {
            userSchemaValidation(req, {}, jest.fn());
            throw new Error('expected userSchemaValidation to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.details).toHaveProperty('name');
            expect(error.details).toHaveProperty('email');
        }
    });
});
