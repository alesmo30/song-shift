process.env.JWT_ACCESS_TOKEN_SECRET = 'test-secret';
process.env.JWT_REFRESH_TOKEN_SECRET = 'test-secret-refresh';
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';

const request = require('supertest');
const server = require('../../server');
const prisma = require('../../lib/prisma');
const jwt = require('jsonwebtoken');

jest.mock('../../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
    },
}));

jest.mock('../../utils/logger');

describe('User Integration Tests', () => {
    const adminToken = jwt.sign({ id: 'admin-id', email: 'admin@test.com', role: 'ADMIN' }, process.env.JWT_ACCESS_TOKEN_SECRET);
    const userToken = jwt.sign({ id: 'user-id', email: 'user@test.com', role: 'USER' }, process.env.JWT_ACCESS_TOKEN_SECRET);

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /users', () => {
        it('should return 400 for validation errors', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'admin-id', role: 'ADMIN', email: 'admin@test.com' });

            const res = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'J', // too short
                    email: 'invalid-email'
                });

            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('errors');
            expect(res.body.errors).toHaveProperty('name');
            expect(res.body.errors).toHaveProperty('email');
        });

        it('should return 201 when created by ADMIN', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'admin-id', role: 'ADMIN', email: 'admin@test.com' });
            prisma.user.findFirst.mockResolvedValue(null);
            prisma.user.create.mockResolvedValue({ id: '2', name: 'New User' });

            const res = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    name: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    password: 'Password123!',
                    role: 'USER'
                });

            expect(res.status).toBe(201);
            expect(res.body.id).toBe('2');
        });

        it('should return 403 when created by non-ADMIN', async () => {
            prisma.user.findUnique.mockResolvedValue({ id: 'user-id', role: 'USER', email: 'user@test.com' });

            const res = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${userToken}`)
                .send({
                    name: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    password: 'Password123!',
                    role: 'USER'
                });

            expect(res.status).toBe(403);
        });

        it('should return 401 when no token provided', async () => {
            const res = await request(server)
                .post('/users')
                .send({
                    name: 'John',
                    lastName: 'Doe',
                    email: 'john@example.com',
                    password: 'Password123!',
                    role: 'USER'
                });

            expect(res.status).toBe(401);
        });
    });

    describe('GET /users/:id', () => {
        it('should return 200 and the user', async () => {
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: 'user-id', role: 'USER', email: 'user@test.com' }) // For auth
                .mockResolvedValueOnce({ id: 'some-id', name: 'Some User' }); // For getUser

            const res = await request(server)
                .get('/users/some-id')
                .set('Authorization', `Bearer ${userToken}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe('some-id');
        });
    });
});
