const { saveUser, getUser } = require('../../../services/users/user');
const prisma = require('../../../lib/prisma');
const bcrypt = require('bcryptjs');
const { AppError } = require('../../../utils/errors');

jest.mock('../../../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
    },
}));

jest.mock('bcryptjs');
jest.mock('../../../utils/logger');

describe('User Service', () => {
    let req, res, next;

    beforeEach(() => {
        res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn()
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('saveUser', () => {
        beforeEach(() => {
            req = {
                body: {
                    name: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    password: 'password123',
                    role: 'USER'
                }
            };
        });

        it('should create a user successfully', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            bcrypt.hash.mockResolvedValue('hashedPassword');
            const mockCreatedUser = { id: '1', ...req.body, password: 'hashedPassword' };
            delete mockCreatedUser.password;
            prisma.user.create.mockResolvedValue(mockCreatedUser);

            await saveUser(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.send).toHaveBeenCalledWith(mockCreatedUser);
        });

        it('should throw AppError if user already exists', async () => {
            prisma.user.findFirst.mockResolvedValue({ id: '1', email: 'john@example.com' });

            await saveUser(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            expect(next.mock.calls[0][0].statusCode).toBe(400);
            expect(next.mock.calls[0][0].message).toBe('User already exists');
        });
    });

    describe('getUser', () => {
        it('should return a user if found', async () => {
            req = { params: { id: '1' } };
            const mockUser = { id: '1', name: 'John' };
            prisma.user.findUnique.mockResolvedValue(mockUser);

            await getUser(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith(mockUser);
        });

        it('should throw AppError if user not found', async () => {
            req = { params: { id: '1' } };
            prisma.user.findUnique.mockResolvedValue(null);

            await getUser(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            expect(next.mock.calls[0][0].statusCode).toBe(404);
            expect(next.mock.calls[0][0].message).toBe('User not found');
        });

        it('should throw AppError if id is missing', async () => {
            req = { params: {} };

            await getUser(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(AppError));
            expect(next.mock.calls[0][0].statusCode).toBe(400);
            expect(next.mock.calls[0][0].message).toBe('User id is required');
        });
    });
});
