const request = require('supertest');
const prisma = require('../lib/prisma');
const server = require('../server');

jest.mock('../lib/prisma', () => ({
    user: {
        findFirst: jest.fn()
    }
}));

describe('POST /login rate limiting (integration)', () => {
    it('returns 429 once the same IP exceeds 10 requests within the window', async () => {
        prisma.user.findFirst.mockResolvedValue(null);

        const attempt = () => request(server)
            .post('/login')
            .send({ email: 'user@example.com', password: 'wrong-password' });

        for (let i = 0; i < 10; i++) {
            const response = await attempt();
            expect(response.status).toBe(401);
        }

        const blockedResponse = await attempt();

        expect(blockedResponse.status).toBe(429);
        expect(blockedResponse.body.status).toBe('error');
    });
});
