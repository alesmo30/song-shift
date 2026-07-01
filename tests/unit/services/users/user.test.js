const { getUser } = require('../../../../services/users/user');
const prisma = require('../../../../lib/prisma');
const logger = require('../../../../utils/logger');
const { AppError } = require('../../../../utils/errors');

jest.mock('../../../../lib/prisma', () => ({
    user: {
        findUnique: jest.fn(),
    },
}));

jest.mock('../../../../utils/logger', () => ({
    error: jest.fn(),
    info: jest.fn(),
}));

describe('getUser service', () => {
    let req;
    let res;
    let next;

    beforeEach(() => {
        req = {
            params: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    it('should return 400 and call next with AppError when id is missing', async () => {
        req.params.id = undefined;

        await getUser(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(AppError));
        const error = next.mock.calls[0][0];
        expect(error.message).toBe('User id is required');
        expect(error.statusCode).toBe(400);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[getUser] Error: User id is required'));
    });

    it('should return 200 and the user when user is found', async () => {
        const mockUser = {
            id: '123',
            name: 'John',
            lastName: 'Doe',
            email: 'john@example.com',
            role: 'USER',
        };
        req.params.id = '123';
        prisma.user.findUnique.mockResolvedValue(mockUser);

        await getUser(req, res, next);

        expect(prisma.user.findUnique).toHaveBeenCalledWith({
            select: expect.any(Object),
            where: { id: '123' },
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith(mockUser);
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[getUser] User found: 123'));
    });

    it('should return 404 and call next with AppError when user is not found', async () => {
        req.params.id = 'nonexistent';
        prisma.user.findUnique.mockResolvedValue(null);

        await getUser(req, res, next);

        expect(next).toHaveBeenCalledWith(expect.any(AppError));
        const error = next.mock.calls[0][0];
        expect(error.message).toBe('User not found');
        expect(error.statusCode).toBe(404);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('[getUser] Error: User not found: nonexistent'));
    });
});
