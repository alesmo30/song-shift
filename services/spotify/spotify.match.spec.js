const prisma = require('../../lib/prisma');
const { spotifyFetch } = require('./spotify.client');
const { RateLimitError, AppError } = require('../../utils/errors');
const { buildQueries, matchTracks } = require('./spotify.match');

jest.mock('../../lib/prisma', () => ({
    spotifyAccount: {
        findUnique: jest.fn()
    }
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn()
}));

jest.mock('./spotify.client', () => ({
    spotifyFetch: jest.fn()
}));

describe('services/spotify/spotify.match', () => {
    const buildReq = (overrides = {}) => ({
        user: { id: 'user-1' },
        body: {},
        ...overrides
    });

    const buildRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        return res;
    };

    const track = (overrides = {}) => ({
        uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr',
        id: '1BxfuPKGuaTgP7aM0Bbdwr',
        name: 'Cruel Summer',
        artists: [{ name: 'Taylor Swift' }],
        album: { name: 'Lover', album_type: 'album', images: [{ url: 'https://example.com/cover.jpg' }] },
        duration_ms: 178426,
        explicit: false,
        popularity: 94,
        external_ids: { isrc: 'USUG11901473' },
        preview_url: null,
        ...overrides
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('buildQueries', () => {
        it('builds a field-filtered query and a free-text fallback, with market attached', () => {
            const queries = buildQueries({ title: 'Cruel Summer', artist: 'Taylor Swift' }, 'US');

            expect(queries).toEqual([
                { q: 'track:"cruel summer" artist:"taylor swift"', type: 'track', limit: 10, market: 'US' },
                { q: 'cruel summer taylor swift', type: 'track', limit: 20, market: 'US' }
            ]);
        });

        it('prepends an isrc query when the source carries one', () => {
            const queries = buildQueries({ title: 'Cruel Summer', artist: 'Taylor Swift', isrc: 'USUG11901473' }, 'US');

            expect(queries[0]).toEqual({ q: 'isrc:USUG11901473', type: 'track', limit: 5 });
        });
    });

    describe('matchTracks', () => {
        it('returns a matched result on the field-filtered query without falling back', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ country: 'US' });
            spotifyFetch.mockResolvedValueOnce({ tracks: { items: [track()] } });

            const req = buildReq({
                body: { songs: [{ id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift', duration: '2:58', confidence: 95 }] }
            });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            expect(spotifyFetch).toHaveBeenCalledTimes(1);
            expect(res.status).toHaveBeenCalledWith(200);

            const [{ results, partial }] = res.json.mock.calls[0];
            expect(partial).toBe(false);
            expect(results).toHaveLength(1);
            expect(results[0].sourceId).toBe('d1');
            expect(results[0].status).toBe('matched');
            expect(results[0].candidates.length).toBeGreaterThan(0);
        });

        it('falls back to the free-text query when the field-filtered search finds nothing', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ country: 'US' });
            spotifyFetch
                .mockResolvedValueOnce({ tracks: { items: [] } })
                .mockResolvedValueOnce({ tracks: { items: [track()] } });

            const req = buildReq({
                body: { songs: [{ id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift', duration: '2:58', confidence: 95 }] }
            });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            expect(spotifyFetch).toHaveBeenCalledTimes(2);
            const [{ results }] = res.json.mock.calls[0];
            expect(results[0].status).toBe('matched');
        });

        it('returns not_found with candidates when no query scores above the ambiguous threshold', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ country: 'US' });
            const unrelated = track({ name: 'Completely Different', artists: [{ name: 'Nobody' }] });
            spotifyFetch
                .mockResolvedValueOnce({ tracks: { items: [unrelated] } })
                .mockResolvedValueOnce({ tracks: { items: [unrelated] } });

            const req = buildReq({
                body: { songs: [{ id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift', duration: '2:58', confidence: 95 }] }
            });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            const [{ results }] = res.json.mock.calls[0];
            expect(results[0].status).toBe('not_found');
            expect(results[0].best).toBeNull();
            expect(results[0].candidates.length).toBeGreaterThan(0);
        });

        it('marks partial true and keeps other songs when one song search throws', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ country: 'US' });
            spotifyFetch
                .mockRejectedValueOnce(new AppError('boom', 502))
                .mockResolvedValueOnce({ tracks: { items: [] } })
                .mockResolvedValueOnce({ tracks: { items: [track()] } });

            const req = buildReq({
                body: {
                    songs: [
                        { id: 'broken', title: 'Broken', artist: 'X', duration: null, confidence: 90 },
                        { id: 'ok', title: 'Cruel Summer', artist: 'Taylor Swift', duration: '2:58', confidence: 95 }
                    ]
                }
            });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            const [{ results, partial }] = res.json.mock.calls[0];
            expect(partial).toBe(true);
            expect(results.find((r) => r.sourceId === 'broken').status).toBe('not_found');
            expect(results.find((r) => r.sourceId === 'ok').status).toBe('matched');
        });

        it('propagates a 409 SPOTIFY_NOT_CONNECTED to the error handler without calling Spotify', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(null);

            const req = buildReq({ body: { songs: [{ id: 'd1', title: 'Song', artist: 'Artist' }] } });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 409,
                details: { code: 'SPOTIFY_NOT_CONNECTED' }
            }));
            expect(spotifyFetch).not.toHaveBeenCalled();
        });

        it('propagates a RateLimitError to the error handler instead of marking that song partial', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ country: 'US' });
            spotifyFetch.mockRejectedValueOnce(new RateLimitError('Spotify rate limit exceeded', 5));

            const req = buildReq({
                body: { songs: [{ id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift' }] }
            });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(RateLimitError));
            expect(res.json).not.toHaveBeenCalled();
        });

        it('never issues more than 5 concurrent searches for a batch of songs', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ country: 'US' });

            let active = 0;
            let maxActive = 0;
            spotifyFetch.mockImplementation(async () => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active -= 1;
                return { tracks: { items: [track()] } };
            });

            const songs = Array.from({ length: 12 }, (_, i) => ({
                id: `s${i}`,
                title: 'Cruel Summer',
                artist: 'Taylor Swift',
                duration: '2:58',
                confidence: 95
            }));

            const req = buildReq({ body: { songs } });
            const res = buildRes();
            const next = jest.fn();

            await matchTracks(req, res, next);

            expect(maxActive).toBeLessThanOrEqual(5);
        });
    });
});
