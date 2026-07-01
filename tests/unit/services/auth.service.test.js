const { login } = require('../../../services/auth/auth');
const prisma = require('../../../lib/prisma');
const bcrypt = require('bcryptjs');
const TokenService = require('../../../services/token/token.service');
const { AuthenticationError } = require('../../../utils/errors');

jest.mock('../../../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
    },
}));

jest.mock('bcryptjs');
jest.mock('../../../services/token/token.service');
jest.mock('../../../utils/logger');

describe('Auth Service', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            body: {
                email: 'test@example.com',
                password: 'password123'
            }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('login', () => {
        it('should login successfully and return tokens', async () => {
            const mockUser = {
                id: '1',
                email: 'test@example.com',
                password: 'hashedPassword',
                role: 'USER'
            };
            const mockTokens = { accessToken: 'at', refreshToken: 'rt' };

            prisma.user.findFirst.mockResolvedValue(mockUser);
            bcrypt.compare.mockResolvedValue(true);

            const mockTokenServiceInstance = {
                generateToken: jest.fn().mockReturnValue(mockTokens)
            };
            TokenService.mockImplementation(() => mockTokenServiceInstance);

            await login(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith(mockTokens);
        });

        it('should throw AuthenticationError if user not found', async () => {
            prisma.user.findFirst.mockResolvedValue(null);

            await login(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
            expect(next.mock.calls[0][0].message).toBe('Invalid email or password');
        });

        it('should throw AuthenticationError if password invalid', async () => {
            const mockUser = { id: '1', password: 'hashedPassword' };
            prisma.user.findFirst.mockResolvedValue(mockUser);
            bcrypt.compare.mockResolvedValue(false);

            await login(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(AuthenticationError));
            expect(next.mock.calls[0][0].message).toBe('Invalid email or password');
        });

        it('should call next with error if something fails', async () => {
            prisma.user.findFirst.mockRejectedValue(new Error('DB Error'));

            await login(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });
    });
});
