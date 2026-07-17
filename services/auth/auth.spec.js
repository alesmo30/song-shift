const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const prismaClient = require('../../lib/prisma');
const TokenService = require('../token/token.service');
const tokenSchemaModel = require('../../mongo/token-schema');
const { login, renewTokens } = require('./auth');
const { AuthenticationError } = require('../../utils/errors');

jest.mock('../../lib/prisma', () => ({
    user: {
        findFirst: jest.fn()
    }
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
    sign: jest.fn()
}));

jest.mock('mongoose', () => ({
    startSession: jest.fn()
}));

jest.mock('../../mongo/token-schema', () => {
    const MockToken = jest.fn().mockImplementation((data) => {
        return {
            ...data,
            save: jest.fn().mockResolvedValue(data)
        };
    });
    MockToken.findOne = jest.fn();
    MockToken.updateOne = jest.fn();
    return MockToken;
});

describe('services/auth/auth', () => {
    const buildReq = (body) => ({ body });
    const buildRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.send = jest.fn().mockReturnValue(res);
        return res;
    };

    beforeEach(() => {
        jwt.sign.mockImplementation((_payload, secret) => `stub-token-for-${secret}`);
    });

    it('calls next with AuthenticationError when the user is not found', async () => {
        prismaClient.user.findFirst.mockResolvedValue(null);
        const req = buildReq({ email: 'missing@example.com', password: 'secret123' });
        const res = buildRes();
        const next = jest.fn();

        await login(req, res, next);

        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
        expect(bcrypt.compare).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('calls next with AuthenticationError when the password is invalid', async () => {
        prismaClient.user.findFirst.mockResolvedValue({
            id: '1',
            email: 'user@example.com',
            role: 'USER',
            password: 'hashed-password'
        });
        bcrypt.compare.mockResolvedValue(false);
        const req = buildReq({ email: 'user@example.com', password: 'wrong-password' });
        const res = buildRes();
        const next = jest.fn();

        await login(req, res, next);

        expect(bcrypt.compare).toHaveBeenCalledWith('wrong-password', 'hashed-password');
        expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('responds with both tokens when credentials are valid', async () => {
        const user = { id: '1', email: 'user@example.com', role: 'USER', password: 'hashed-password' };
        prismaClient.user.findFirst.mockResolvedValue(user);
        bcrypt.compare.mockResolvedValue(true);
        const req = buildReq({ email: 'user@example.com', password: 'secret123' });
        const res = buildRes();
        const next = jest.fn();

        await login(req, res, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
            accessToken: 'stub-token-for-test-access-secret',
            refreshToken: 'stub-token-for-test-refresh-secret',
            user: user.id
        }));
        expect(jwt.sign).toHaveBeenCalledWith(
            { id: user.id, email: user.email, role: user.role },
            'test-access-secret',
            { expiresIn: '1d' }
        );
        expect(next).not.toHaveBeenCalled();
    });

    it('forwards unexpected errors to next', async () => {
        const failure = new Error('DB unavailable');
        prismaClient.user.findFirst.mockRejectedValue(failure);
        const req = buildReq({ email: 'user@example.com', password: 'secret123' });
        const res = buildRes();
        const next = jest.fn();

        await login(req, res, next);

        expect(next).toHaveBeenCalledWith(failure);
    });

    describe('login - createTokens session pass-through', () => {
        it('saves the new token without a mongo session (session is undefined)', async () => {
            const user = { id: '1', email: 'user@example.com', role: 'USER', password: 'hashed-password' };
            prismaClient.user.findFirst.mockResolvedValue(user);
            bcrypt.compare.mockResolvedValue(true);
            const req = buildReq({ email: 'user@example.com', password: 'secret123' });
            const res = buildRes();
            const next = jest.fn();

            await login(req, res, next);

            const lastInstance = tokenSchemaModel.mock.results[tokenSchemaModel.mock.results.length - 1].value;
            expect(lastInstance.save).toHaveBeenCalledWith({ session: undefined });
        });
    });

    describe('renewTokens', () => {
        const buildRenewReq = (body) => ({ body });
        let isRefreshTokenStillActiveSpy;

        beforeEach(() => {
            isRefreshTokenStillActiveSpy = jest.spyOn(TokenService, 'isRefreshTokenStillActive');
            jwt.sign.mockImplementation((_payload, secret) => `stub-token-for-${secret}`);
        });

        afterEach(() => {
            isRefreshTokenStillActiveSpy.mockRestore();
        });

        const buildSession = () => ({
            withTransaction: jest.fn(async (callback) => {
                await callback();
            }),
            endSession: jest.fn().mockResolvedValue(undefined)
        });

        it('rotates the tokens when the refresh token matches but is no longer within its active window', async () => {
            const lastValidTokenByUser = { _id: 'token-id-1', refreshToken: 'old-refresh-token' };
            tokenSchemaModel.findOne.mockResolvedValue(lastValidTokenByUser);
            tokenSchemaModel.updateOne.mockResolvedValue({ acknowledged: true });
            isRefreshTokenStillActiveSpy.mockReturnValue(false);
            prismaClient.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'USER' });

            const session = buildSession();
            mongoose.startSession.mockResolvedValue(session);

            const req = buildRenewReq({ refreshToken: 'old-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await renewTokens(req, res);

            expect(tokenSchemaModel.updateOne).toHaveBeenCalledWith(
                { _id: 'token-id-1' },
                { $set: { active: false } },
                { session }
            );

            const lastInstance = tokenSchemaModel.mock.results[tokenSchemaModel.mock.results.length - 1].value;
            expect(lastInstance.save).toHaveBeenCalledWith({ session });

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith({
                accessToken: 'stub-token-for-test-access-secret',
                refreshToken: 'stub-token-for-test-refresh-secret'
            });
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('returns "Token is still valid" without touching mongo when the refresh token is still active', async () => {
            tokenSchemaModel.findOne.mockResolvedValue({ _id: 'token-id-1', refreshToken: 'active-refresh-token' });
            isRefreshTokenStillActiveSpy.mockReturnValue(true);

            const req = buildRenewReq({ refreshToken: 'active-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await renewTokens(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith({ message: 'Token is still valid' });
            expect(tokenSchemaModel.updateOne).not.toHaveBeenCalled();
            expect(mongoose.startSession).not.toHaveBeenCalled();
            expect(prismaClient.user.findFirst).not.toHaveBeenCalled();
        });

        it('throws AuthenticationError when the supplied refresh token does not match the last valid one', async () => {
            tokenSchemaModel.findOne.mockResolvedValue({ _id: 'token-id-1', refreshToken: 'stored-refresh-token' });

            const req = buildRenewReq({ refreshToken: 'mismatched-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await expect(renewTokens(req, res)).rejects.toMatchObject({
                name: 'AuthenticationError',
                message: 'Invalid refresh token'
            });
            expect(isRefreshTokenStillActiveSpy).not.toHaveBeenCalled();
            expect(mongoose.startSession).not.toHaveBeenCalled();
        });

        it('throws AuthenticationError when there is no active token stored for the user', async () => {
            tokenSchemaModel.findOne.mockResolvedValue(null);

            const req = buildRenewReq({ refreshToken: 'some-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await expect(renewTokens(req, res)).rejects.toMatchObject({
                name: 'AuthenticationError',
                message: 'Invalid refresh token'
            });
        });

        it('throws AuthenticationError when the user behind the token no longer exists', async () => {
            tokenSchemaModel.findOne.mockResolvedValue({ _id: 'token-id-1', refreshToken: 'old-refresh-token' });
            isRefreshTokenStillActiveSpy.mockReturnValue(false);
            prismaClient.user.findFirst.mockResolvedValue(null);

            const req = buildRenewReq({ refreshToken: 'old-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await expect(renewTokens(req, res)).rejects.toMatchObject({
                name: 'AuthenticationError',
                message: 'User not found'
            });
            expect(mongoose.startSession).not.toHaveBeenCalled();
        });

        it('rolls back by rethrowing as AuthenticationError, and always ends the session, when creating the new token fails inside the transaction', async () => {
            const lastValidTokenByUser = { _id: 'token-id-1', refreshToken: 'old-refresh-token' };
            tokenSchemaModel.findOne.mockResolvedValue(lastValidTokenByUser);
            tokenSchemaModel.updateOne.mockResolvedValue({ acknowledged: true });
            isRefreshTokenStillActiveSpy.mockReturnValue(false);
            prismaClient.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'USER' });

            // Simulate the underlying tokenModel.save() failing while inside the transaction.
            tokenSchemaModel.mockImplementationOnce((data) => ({
                ...data,
                save: jest.fn().mockRejectedValue(new Error('Failed to persist new token'))
            }));

            const session = buildSession();
            mongoose.startSession.mockResolvedValue(session);

            const req = buildRenewReq({ refreshToken: 'old-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await expect(renewTokens(req, res)).rejects.toMatchObject({
                name: 'AuthenticationError',
                message: 'Failed to persist new token'
            });

            // Proves the failure happened inside the withTransaction callback (after the
            // deactivation write), demonstrating the rollback wiring is in place.
            expect(session.withTransaction).toHaveBeenCalledTimes(1);
            expect(tokenSchemaModel.updateOne).toHaveBeenCalledWith(
                { _id: 'token-id-1' },
                { $set: { active: false } },
                { session }
            );
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('still ends the session when session.withTransaction itself rejects', async () => {
            tokenSchemaModel.findOne.mockResolvedValue({ _id: 'token-id-1', refreshToken: 'old-refresh-token' });
            isRefreshTokenStillActiveSpy.mockReturnValue(false);
            prismaClient.user.findFirst.mockResolvedValue({ id: 'user-1', email: 'user@example.com', role: 'USER' });

            const session = {
                withTransaction: jest.fn().mockRejectedValue(new Error('Transaction infrastructure error')),
                endSession: jest.fn().mockResolvedValue(undefined)
            };
            mongoose.startSession.mockResolvedValue(session);

            const req = buildRenewReq({ refreshToken: 'old-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await expect(renewTokens(req, res)).rejects.toMatchObject({
                name: 'AuthenticationError',
                message: 'Transaction infrastructure error'
            });
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('falls back to a generic message when the underlying error has no string message', async () => {
            tokenSchemaModel.findOne.mockRejectedValue({ code: 'MONGO_DOWN' });

            const req = buildRenewReq({ refreshToken: 'old-refresh-token', userId: 'user-1' });
            const res = buildRes();

            await expect(renewTokens(req, res)).rejects.toMatchObject({
                name: 'AuthenticationError',
                message: 'Something happened trying to renew the tokens. Please try again.'
            });
        });
    });
});
