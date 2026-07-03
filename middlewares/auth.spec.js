const passport = require('passport');
const auth = require('./auth');
const { AuthenticationError } = require('../utils/errors');

jest.mock('passport', () => ({
    authenticate: jest.fn()
}));

describe('middlewares/auth', () => {
    const buildRequestResponse = () => ({ req: { user: undefined }, res: {} });

    it('calls next with AuthenticationError when passport reports an error', async () => {
        passport.authenticate.mockImplementation((strategy, options, callback) => (req, res, next) => {
            callback(new Error('boom'), false, null);
        });
        const { req, res } = buildRequestResponse();
        const next = jest.fn();

        await auth(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    });

    it('calls next with AuthenticationError when passport supplies info instead of a user', async () => {
        passport.authenticate.mockImplementation((strategy, options, callback) => (req, res, next) => {
            callback(null, false, { message: 'No auth token' });
        });
        const { req, res } = buildRequestResponse();
        const next = jest.fn();

        await auth(req, res, next);

        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    });

    it('calls next with AuthenticationError when no user is returned', async () => {
        passport.authenticate.mockImplementation((strategy, options, callback) => (req, res, next) => {
            callback(null, false, null);
        });
        const { req, res } = buildRequestResponse();
        const next = jest.fn();

        await auth(req, res, next);

        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    });

    it('sets req.user and calls next with no arguments when authentication succeeds', async () => {
        const user = { id: '1', email: 'user@example.com', role: 'USER' };
        passport.authenticate.mockImplementation((strategy, options, callback) => (req, res, next) => {
            callback(null, user, null);
        });
        const { req, res } = buildRequestResponse();
        const next = jest.fn();

        await auth(req, res, next);

        expect(req.user).toBe(user);
        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
    });

    it('uses the jwt strategy with session disabled', async () => {
        passport.authenticate.mockImplementation((strategy, options, callback) => (req, res, next) => {
            callback(null, { id: '1' }, null);
        });
        const { req, res } = buildRequestResponse();

        await auth(req, res, jest.fn());

        expect(passport.authenticate).toHaveBeenCalledWith('jwt', { session: false }, expect.any(Function));
    });
});
