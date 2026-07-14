const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prismaClient = require('../../lib/prisma');
const { login } = require('./auth');
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

jest.mock('../../mongo/token-schema', () => {
    return jest.fn().mockImplementation((data) => {
        return {
            ...data,
            save: jest.fn().mockResolvedValue(data)
        };
    });
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
});
