const request = require('supertest');
const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const server = require('../server');

jest.mock('../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
        findUnique: jest.fn()
    }
}));

jest.mock('bcryptjs', () => ({
    compare: jest.fn(),
    hash: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
    sign: jest.fn((payload, secret) => JSON.stringify({ payload, secret })),
    verify: jest.fn((token, secretOrKey, options, callback) => {
        try {
            const decoded = JSON.parse(token);
            if (decoded.secret !== secretOrKey) {
                return callback(new Error('invalid signature'));
            }
            callback(null, decoded.payload);
        } catch (error) {
            callback(error);
        }
    })
}));

describe('POST /login (integration)', () => {
    it('returns 400 when the request body fails validation', async () => {
        const response = await request(server)
            .post('/login')
            .send({ email: 'not-an-email' });

        expect(response.status).toBe(400);
        expect(response.body.status).toBe('error');
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('returns 401 when no user matches the email', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const response = await request(server)
            .post('/login')
            .send({ email: 'missing@example.com', password: 'secret123' });

        expect(response.status).toBe(401);
    });

    it('returns 401 when the password does not match', async () => {
        prisma.user.findFirst.mockResolvedValue({
            id: '1',
            email: 'user@example.com',
            role: 'USER',
            password: 'hashed-password'
        });
        bcrypt.compare.mockResolvedValue(false);

        const response = await request(server)
            .post('/login')
            .send({ email: 'user@example.com', password: 'wrong-password' });

        expect(response.status).toBe(401);
    });

    it('returns 200 with an access and refresh token on valid credentials', async () => {
        prisma.user.findFirst.mockResolvedValue({
            id: '1',
            email: 'user@example.com',
            role: 'USER',
            password: 'hashed-password'
        });
        bcrypt.compare.mockResolvedValue(true);

        const response = await request(server)
            .post('/login')
            .send({ email: 'user@example.com', password: 'secret123' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('accessToken');
        expect(response.body).toHaveProperty('refreshToken');
    });
});
