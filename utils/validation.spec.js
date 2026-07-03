const { formatJoiErrors } = require('./validation');

describe('utils/validation', () => {
    describe('formatJoiErrors', () => {
        it('returns an empty object when error is falsy', () => {
            expect(formatJoiErrors(null)).toEqual({});
            expect(formatJoiErrors(undefined)).toEqual({});
        });

        it('returns an empty object when error has no details', () => {
            expect(formatJoiErrors({})).toEqual({});
        });

        it('maps a single detail to its joined path with quotes stripped', () => {
            const error = {
                details: [
                    { path: ['email'], message: '"email" is required' }
                ]
            };

            expect(formatJoiErrors(error)).toEqual({ email: 'email is required' });
        });

        it('joins nested paths with a dot', () => {
            const error = {
                details: [
                    { path: ['user', 'address', 'zip'], message: '"zip" must be a number' }
                ]
            };

            expect(formatJoiErrors(error)).toEqual({ 'user.address.zip': 'zip must be a number' });
        });

        it('maps multiple details into a single accumulated object', () => {
            const error = {
                details: [
                    { path: ['email'], message: '"email" is required' },
                    { path: ['password'], message: '"password" length must be at least 6 characters long' }
                ]
            };

            expect(formatJoiErrors(error)).toEqual({
                email: 'email is required',
                password: 'password length must be at least 6 characters long'
            });
        });
    });
});
