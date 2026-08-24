const express = require('express');
const request = require('supertest');

const uploadMiddleware = require('./upload.middleware');
const { errorHandler } = require('./error.handler');

const buildApp = () => {
    const app = express();

    app.post('/upload', uploadMiddleware, (req, res) => {
        res.status(200).json({ files: req.files.map((file) => file.mimetype) });
    });

    app.use(errorHandler);

    return app;
};

describe('middlewares/upload.middleware', () => {
    it('returns 400 Validation Error when no files are attached', async () => {
        const response = await request(buildApp()).post('/upload');

        expect(response.status).toBe(400);
        expect(response.body.status).toBe('error');
        expect(response.body.message).toBe('Validation Error');
    });

    it('accepts a single valid png file', async () => {
        const response = await request(buildApp())
            .post('/upload')
            .attach('screenshots', Buffer.from('fake-png'), { filename: 'shot.png', contentType: 'image/png' });

        expect(response.status).toBe(200);
        expect(response.body.files).toEqual(['image/png']);
    });

    it('accepts up to 5 files of allowed types', async () => {
        const req = request(buildApp()).post('/upload');

        for (let i = 0; i < 5; i += 1) {
            req.attach('screenshots', Buffer.from('fake-image'), { filename: `shot-${i}.jpg`, contentType: 'image/jpeg' });
        }

        const response = await req;

        expect(response.status).toBe(200);
        expect(response.body.files).toHaveLength(5);
    });

    it('returns 400 when more than 5 files are attached', async () => {
        const req = request(buildApp()).post('/upload');

        for (let i = 0; i < 6; i += 1) {
            req.attach('screenshots', Buffer.from('fake-image'), { filename: `shot-${i}.jpg`, contentType: 'image/jpeg' });
        }

        const response = await req;

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation Error');
    });

    it('returns 400 when a file exceeds the 4MB size limit', async () => {
        const oversizedBuffer = Buffer.alloc(4 * 1024 * 1024 + 1);

        const response = await request(buildApp())
            .post('/upload')
            .attach('screenshots', oversizedBuffer, { filename: 'big.png', contentType: 'image/png' });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation Error');
    });

    it('forwards a non-multer parsing error to the next error handler', async () => {
        const response = await request(buildApp())
            .post('/upload')
            .set('Content-Type', 'multipart/form-data; boundary=broken')
            .send('--broken\r\nnot a valid multipart body');

        expect(response.status).toBe(500);
    });

    it('returns 400 when a file has a disallowed mime type', async () => {
        const response = await request(buildApp())
            .post('/upload')
            .attach('screenshots', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation Error');
    });
});
