const { authUrlSchemaValidation } = require('./spotify-schema.validation');
const { ValidationError } = require('../utils/errors');

describe('middlewares/spotify-schema.validation', () => {
    const buildReq = (body) => ({ body });

    it('calls next and keeps a valid redirectPath', () => {
        const req = buildReq({ redirectPath: '/dashboard' });
        const next = jest.fn();

        authUrlSchemaValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ redirectPath: '/dashboard' });
    });

    it('defaults redirectPath to "/" when the body is empty', () => {
        const req = buildReq({});
        const next = jest.fn();

        authUrlSchemaValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toEqual({ redirectPath: '/' });
    });

    it('rejects a double-slash redirectPath (open-redirect guard)', () => {
        const req = buildReq({ redirectPath: '//evil.com' });

        expect(() => authUrlSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('rejects an absolute URL as redirectPath', () => {
        const req = buildReq({ redirectPath: 'http://evil.com' });

        try {
            authUrlSchemaValidation(req, {}, jest.fn());
            throw new Error('expected authUrlSchemaValidation to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.details).toHaveProperty('redirectPath');
        }
    });

    it('rejects a redirectPath that does not start with a slash', () => {
        const req = buildReq({ redirectPath: 'dashboard' });

        expect(() => authUrlSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });
});
