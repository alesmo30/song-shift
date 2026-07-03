const bcrypt = require('bcryptjs');
const prisma = require('../../lib/prisma');
const { saveUser, getUser } = require('./user');
const { AppError } = require('../../utils/errors');

jest.mock('../../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn()
    }
}));

jest.mock('bcryptjs', () => ({
    hash: jest.fn()
}));

describe('services/users/user', () => {
    const buildRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.send = jest.fn().mockReturnValue(res);
        return res;
    };

    describe('saveUser', () => {
        const buildReq = (body) => ({
            body: {
                name: 'Jane',
                lastName: 'Doe',
                email: 'jane.doe@example.com',
                password: 'secret123',
                role: 'USER',
                ...body
            }
        });

        it('calls next with a 400 AppError when the email already exists', async () => {
            prisma.user.findFirst.mockResolvedValue({ id: 'existing-id' });
            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await saveUser(req, res, next);

            expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
            expect(next.mock.calls[0][0].statusCode).toBe(400);
            expect(bcrypt.hash).not.toHaveBeenCalled();
            expect(prisma.user.create).not.toHaveBeenCalled();
        });

        it('hashes the password and creates the user on success', async () => {
            prisma.user.findFirst.mockResolvedValue(null);
            bcrypt.hash.mockResolvedValue('hashed-password');
            const createdUser = {
                id: '1',
                name: 'Jane',
                lastName: 'Doe',
                email: 'jane.doe@example.com',
                role: 'USER',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            prisma.user.create.mockResolvedValue(createdUser);
            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await saveUser(req, res, next);

            expect(bcrypt.hash).toHaveBeenCalledWith('secret123', 10);
            expect(prisma.user.create).toHaveBeenCalledWith({
                data: {
                    name: 'Jane',
                    lastName: 'Doe',
                    email: 'jane.doe@example.com',
                    password: 'hashed-password',
                    role: 'USER'
                },
                select: {
                    id: true,
                    name: true,
                    lastName: true,
                    email: true,
                    role: true,
                    createdAt: true,
                    updatedAt: true
                }
            });
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.send).toHaveBeenCalledWith(createdUser);
            expect(next).not.toHaveBeenCalled();
        });

        it('forwards unexpected errors to next', async () => {
            const failure = new Error('DB unavailable');
            prisma.user.findFirst.mockRejectedValue(failure);
            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await saveUser(req, res, next);

            expect(next).toHaveBeenCalledWith(failure);
        });
    });

    describe('getUser', () => {
        const buildReq = (id) => ({ params: { id } });

        it('calls next with a 400 AppError when id is missing', async () => {
            const req = buildReq(undefined);
            const res = buildRes();
            const next = jest.fn();

            await getUser(req, res, next);

            expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
            expect(next.mock.calls[0][0].statusCode).toBe(400);
            expect(prisma.user.findUnique).not.toHaveBeenCalled();
        });

        it('calls next with a 404 AppError when the user is not found', async () => {
            prisma.user.findUnique.mockResolvedValue(null);
            const req = buildReq('missing-id');
            const res = buildRes();
            const next = jest.fn();

            await getUser(req, res, next);

            expect(next.mock.calls[0][0]).toBeInstanceOf(AppError);
            expect(next.mock.calls[0][0].statusCode).toBe(404);
        });

        it('responds with 200 and the user when found', async () => {
            const user = { id: '1', name: 'Jane', lastName: 'Doe', email: 'jane.doe@example.com', role: 'USER' };
            prisma.user.findUnique.mockResolvedValue(user);
            const req = buildReq('1');
            const res = buildRes();
            const next = jest.fn();

            await getUser(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.send).toHaveBeenCalledWith(user);
            expect(next).not.toHaveBeenCalled();
        });

        it('forwards unexpected errors to next', async () => {
            const failure = new Error('DB unavailable');
            prisma.user.findUnique.mockRejectedValue(failure);
            const req = buildReq('1');
            const res = buildRes();
            const next = jest.fn();

            await getUser(req, res, next);

            expect(next).toHaveBeenCalledWith(failure);
        });
    });
});
