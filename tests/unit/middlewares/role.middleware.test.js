const checkRole = require('../../../middlewares/role.middleware');
const { AuthorizationError } = require('../../../utils/errors');

describe('Role Middleware', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
        req = {
            user: null
        };
        res = {};
        next = jest.fn();
    });

    test('should allow access if user has the required role', () => {
        req.user = { role: 'ADMIN' };
        const middleware = checkRole(['ADMIN']);

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(next).not.toHaveBeenCalledWith(expect.any(AuthorizationError));
    });

    test('should allow access if user has one of the required roles', () => {
        req.user = { role: 'USER' };
        const middleware = checkRole(['ADMIN', 'USER']);

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
        expect(next).not.toHaveBeenCalledWith(expect.any(AuthorizationError));
    });

    test('should block access if user does not have the required role', () => {
        req.user = { role: 'USER' };
        const middleware = checkRole(['ADMIN']);

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
        const error = next.mock.calls[0][0];
        expect(error.message).toBe('You do not have permission to perform this action');
        expect(error.statusCode).toBe(403);
    });

    test('should block access if user is not present in request', () => {
        req.user = undefined;
        const middleware = checkRole(['ADMIN']);

        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(AuthorizationError));
        const error = next.mock.calls[0][0];
        expect(error.message).toBe('You do not have permission to perform this action');
        expect(error.statusCode).toBe(403);
    });
});
