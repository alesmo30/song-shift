process.env.JWT_ACCESS_TOKEN_SECRET = 'test-secret';
process.env.JWT_REFRESH_TOKEN_SECRET = 'test-secret-refresh';
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

const request = require('supertest');
const server = require('../../server');
const prisma = require('../../lib/prisma');
const bcrypt = require('bcryptjs');

jest.mock('../../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
    },
}));

jest.mock('bcryptjs');
jest.mock('../../utils/logger');

describe('Auth Integration Tests', () => {
    describe('POST /login', () => {
        it('should return 200 and tokens with valid credentials', async () => {
            const mockUser = {
                id: '1',
                email: 'test@example.com',
                password: 'hashedPassword',
                role: 'USER'
            };
            prisma.user.findFirst.mockResolvedValue(mockUser);
            bcrypt.compare.mockResolvedValue(true);

            const res = await request(server)
                .post('/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123'
                });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('accessToken');
            expect(res.body).toHaveProperty('refreshToken');
        });

        it('should return 400 for invalid request body', async () => {
            const res = await request(server)
                .post('/login')
                .send({
                    email: 'invalid-email'
                });

            expect(res.status).toBe(400);
        });

        it('should return 401 for invalid credentials', async () => {
            prisma.user.findFirst.mockResolvedValue(null);

            const res = await request(server)
                .post('/login')
                .send({
                    email: 'wrong@example.com',
                    password: 'wrongpassword'
                });

            expect(res.status).toBe(401);
            expect(res.body.message).toBe('Invalid email or password');
        });

        it('should return 500 for unhandled errors', async () => {
            prisma.user.findFirst.mockRejectedValue(new Error('Unexpected error'));

            const res = await request(server)
                .post('/login')
                .send({
                    email: 'test@example.com',
                    password: 'password123'
                });

            expect(res.status).toBe(500);
            expect(res.body.message).toBe('Internal server error. Something went wrong.');
        });
    });
});
