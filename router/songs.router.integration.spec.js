const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { extractSongsFromImage } = require('../services/groq/groq.client');
const { buildSongId } = require('../utils/song-normalizer');
const server = require('../server');

jest.mock('../lib/prisma', () => ({
    user: {
        findUnique: jest.fn()
    }
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

jest.mock('../services/groq/groq.client', () => ({
    extractSongsFromImage: jest.fn()
}));

const buildToken = (payload) => jwt.sign(payload, process.env.JWT_ACCESS_TOKEN_SECRET);

const png = () => Buffer.from('fake-png');

describe('songs.router (integration)', () => {
    const authenticatedUser = { id: '1', email: 'user@example.com', role: 'USER' };

    beforeEach(() => {
        prisma.user.findUnique.mockResolvedValue(authenticatedUser);
    });

    describe('POST /songs/extract', () => {
        it('returns 401 without an Authorization header', async () => {
            const response = await request(server)
                .post('/songs/extract')
                .attach('screenshots', png(), { filename: 'shot.png', contentType: 'image/png' });

            expect(response.status).toBe(401);
        });

        it('returns 200 with at least one song per readable screenshot', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            extractSongsFromImage
                .mockResolvedValueOnce([{ title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 90 }])
                .mockResolvedValueOnce([{ title: 'Song B', artist: 'Artist', duration: '2:30', confidence: 80 }]);

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', png(), { filename: 'shot1.png', contentType: 'image/png' })
                .attach('screenshots', png(), { filename: 'shot2.png', contentType: 'image/png' });

            expect(response.status).toBe(200);
            expect(response.body.processed).toBe(2);
            expect(response.body.failed).toBe(0);
            expect(response.body.songs).toHaveLength(2);
        });

        it('deduplicates a song that appears in both screenshots', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            extractSongsFromImage
                .mockResolvedValueOnce([{ title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 90 }])
                .mockResolvedValueOnce([{ title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 85 }]);

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', png(), { filename: 'shot1.png', contentType: 'image/png' })
                .attach('screenshots', png(), { filename: 'shot2.png', contentType: 'image/png' });

            expect(response.status).toBe(200);
            expect(response.body.songs).toHaveLength(1);
            expect(response.body.songs[0].id).toBe(buildSongId('Song A', 'Artist'));
        });

        it('produces the same id when the same screenshot is uploaded twice', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            const song = { title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 90 };
            extractSongsFromImage.mockResolvedValue([song]);

            const first = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', png(), { filename: 'shot.png', contentType: 'image/png' });

            const second = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', png(), { filename: 'shot.png', contentType: 'image/png' });

            expect(first.body.songs[0].id).toBe(second.body.songs[0].id);
        });

        it('returns 400 with a Validation Error message when no files are attached', async () => {
            const token = buildToken({ email: authenticatedUser.email });

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`);

            expect(response.status).toBe(400);
            expect(response.body.status).toBe('error');
            expect(response.body.message).toBe('Validation Error');
        });

        it('returns 400, not 500, for a file over the 5MB limit', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            const oversized = Buffer.alloc(5 * 1024 * 1024);

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', oversized, { filename: 'big.png', contentType: 'image/png' });

            expect(response.status).toBe(400);
        });

        it('returns 400 for a .pdf file in the screenshots field', async () => {
            const token = buildToken({ email: authenticatedUser.email });

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });

            expect(response.status).toBe(400);
        });

        it('returns 200 with failed: 1 when one of two screenshots errors out in Groq', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            extractSongsFromImage
                .mockResolvedValueOnce([{ title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 90 }])
                .mockRejectedValueOnce(new Error('Groq extraction failed'));

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', png(), { filename: 'shot1.png', contentType: 'image/png' })
                .attach('screenshots', png(), { filename: 'shot2.png', contentType: 'image/png' });

            expect(response.status).toBe(200);
            expect(response.body.failed).toBe(1);
            expect(response.body.songs).toHaveLength(1);
        });

        it('does not let a Groq 502 (e.g. an invalid API key) surface as a 500 — the screenshot just counts as failed', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            const { AppError } = require('../utils/errors');
            extractSongsFromImage.mockRejectedValue(new AppError('Groq extraction failed', 502));

            const response = await request(server)
                .post('/songs/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('screenshots', png(), { filename: 'shot.png', contentType: 'image/png' });

            expect(response.status).toBe(200);
            expect(response.body.failed).toBe(1);
        });
    });

    describe('POST /songs/playlist', () => {
        it('returns 401 without an Authorization header', async () => {
            const response = await request(server)
                .post('/songs/playlist')
                .send({ songs: [] });

            expect(response.status).toBe(401);
        });

        it('returns 400 when songs is empty', async () => {
            const token = buildToken({ email: authenticatedUser.email });

            const response = await request(server)
                .post('/songs/playlist')
                .set('Authorization', `Bearer ${token}`)
                .send({ songs: [] });

            expect(response.status).toBe(400);
        });

        it('returns 202 with status not-implemented for 1..100 songs', async () => {
            const token = buildToken({ email: authenticatedUser.email });
            const songs = [{ id: 'abc123', title: 'Song', artist: 'Artist', duration: '3:00' }];

            const response = await request(server)
                .post('/songs/playlist')
                .set('Authorization', `Bearer ${token}`)
                .send({ songs });

            expect(response.status).toBe(202);
            expect(response.body.status).toBe('not-implemented');
        });
    });
});
