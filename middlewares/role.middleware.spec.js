const checkRole = require('./role.middleware');
const { AuthorizationError } = require('../utils/errors');

describe('middlewares/role.middleware', () => {
    const buildReq = (user) => ({ user });

    it('calls next with AuthorizationError when req.user is missing', () => {
        const middleware = checkRole(['ADMIN']);
        const next = jest.fn();

        middleware(buildReq(undefined), {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
    });

    it('calls next with AuthorizationError when role is not in the allowed list', () => {
        const middleware = checkRole(['ADMIN']);
        const next = jest.fn();

        middleware(buildReq({ role: 'USER' }), {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthorizationError);
    });

    it('calls next with no arguments when role is allowed', () => {
        const middleware = checkRole(['ADMIN', 'USER']);
        const next = jest.fn();

        middleware(buildReq({ role: 'USER' }), {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });
});
