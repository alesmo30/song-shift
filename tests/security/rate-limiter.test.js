const express = require('express');
const request = require('supertest');
const { authRateLimiter } = require('../../middlewares/rate-limiter');

describe('Rate Limiter Middleware', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());

        // Mock route with rate limiter
        app.post('/test-login', authRateLimiter, (req, res) => {
            res.status(200).json({ message: 'Success' });
        });

        // Error handler
        app.use((err, req, res, next) => {
            res.status(err.statusCode || 500).json({ message: err.message });
        });
    });

    it('should allow requests within the limit', async () => {
        for (let i = 0; i < 10; i++) {
            const response = await request(app).post('/test-login').send({ email: 'test@example.com', password: 'password' });
            expect(response.status).toBe(200);
        }
    });

    it('should rate limit requests exceeding the limit', async () => {
        // Use up the 10 allowed requests
        for (let i = 0; i < 10; i++) {
            await request(app).post('/test-login').send({ email: 'test@example.com', password: 'password' });
        }

        // The 11th request should be rate limited
        const response = await request(app).post('/test-login').send({ email: 'test@example.com', password: 'password' });
        expect(response.status).toBe(429);
        expect(response.body.message).toBe('Too many login attempts from this IP, please try again after 15 minutes');
    });
});
