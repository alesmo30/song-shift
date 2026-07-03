const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const server = require('../server');

jest.mock('../lib/prisma', () => ({
    user: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn()
    }
}));

jest.mock('bcryptjs', () => ({
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

const buildToken = (payload) => jwt.sign(payload, process.env.JWT_ACCESS_TOKEN_SECRET);

describe('user.router (integration)', () => {
    describe('POST /users', () => {
        const validBody = {
            name: 'Jane',
            lastName: 'Doe',
            email: 'jane.doe@example.com',
            password: 'secret123'
        };

        it('returns 401 without a token', async () => {
            const response = await request(server).post('/users').send(validBody);

            expect(response.status).toBe(401);
        });

        it('returns 403 when the authenticated user is not an ADMIN', async () => {
            const token = buildToken({ id: '1', email: 'user@example.com', role: 'USER' });
            prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'user@example.com', role: 'USER' });

            const response = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${token}`)
                .send(validBody);

            expect(response.status).toBe(403);
        });

        it('returns 400 for an invalid body even when authenticated as ADMIN', async () => {
            const token = buildToken({ id: '1', email: 'admin@example.com', role: 'ADMIN' });
            prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'admin@example.com', role: 'ADMIN' });

            const response = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${token}`)
                .send({ email: 'not-an-email' });

            expect(response.status).toBe(400);
        });

        it('returns 400 when the email already exists', async () => {
            const token = buildToken({ id: '1', email: 'admin@example.com', role: 'ADMIN' });
            prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'admin@example.com', role: 'ADMIN' });
            prisma.user.findFirst.mockResolvedValue({ id: 'existing-id' });

            const response = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${token}`)
                .send(validBody);

            expect(response.status).toBe(400);
        });

        it('returns 201 and the created user on success', async () => {
            const token = buildToken({ id: '1', email: 'admin@example.com', role: 'ADMIN' });
            prisma.user.findUnique.mockResolvedValue({ id: '1', email: 'admin@example.com', role: 'ADMIN' });
            prisma.user.findFirst.mockResolvedValue(null);
            bcrypt.hash.mockResolvedValue('hashed-password');
            const createdUser = {
                id: '2',
                name: 'Jane',
                lastName: 'Doe',
                email: 'jane.doe@example.com',
                role: 'USER',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            prisma.user.create.mockResolvedValue(createdUser);

            const response = await request(server)
                .post('/users')
                .set('Authorization', `Bearer ${token}`)
                .send(validBody);

            expect(response.status).toBe(201);
            expect(response.body).toEqual(createdUser);
        });
    });

    describe('GET /users/:id', () => {
        it('returns 401 without a token', async () => {
            const response = await request(server).get('/users/1');

            expect(response.status).toBe(401);
        });

        it('returns 404 when the user is not found', async () => {
            const token = buildToken({ id: '1', email: 'user@example.com', role: 'USER' });
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: '1', email: 'user@example.com', role: 'USER' })
                .mockResolvedValueOnce(null);

            const response = await request(server)
                .get('/users/missing-id')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(404);
        });

        it('returns 200 with the user when found', async () => {
            const token = buildToken({ id: '1', email: 'user@example.com', role: 'USER' });
            const targetUser = {
                id: '2',
                name: 'Jane',
                lastName: 'Doe',
                email: 'jane.doe@example.com',
                role: 'USER'
            };
            prisma.user.findUnique
                .mockResolvedValueOnce({ id: '1', email: 'user@example.com', role: 'USER' })
                .mockResolvedValueOnce(targetUser);

            const response = await request(server)
                .get('/users/2')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(200);
            expect(response.body).toEqual(targetUser);
        });
    });
});
