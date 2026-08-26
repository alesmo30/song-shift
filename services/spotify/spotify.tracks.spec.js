const prisma = require('../../lib/prisma');
const { spotifyFetch } = require('./spotify.client');
const { readPlaylistUris, addTracks } = require('./spotify.tracks');

jest.mock('./spotify.client', () => ({
    spotifyFetch: jest.fn()
}));

jest.mock('../../lib/prisma', () => ({
    spotifyAccount: {
        findUnique: jest.fn()
    }
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn()
}));

describe('services/spotify/spotify.tracks', () => {
    const buildReq = (overrides = {}) => ({
        user: { id: 'user-1' },
        params: { playlistId: 'playlist-1' },
        body: {},
        ...overrides
    });

    const buildRes = () => {
        const res = {};
        res.status = jest.fn().mockReturnValue(res);
        res.json = jest.fn().mockReturnValue(res);
        return res;
    };

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('readPlaylistUris', () => {
        it('pages through the playlist until next is exhausted and returns a Set of uris', async () => {
            spotifyFetch
                .mockResolvedValueOnce({
                    items: [{ item: { uri: 'spotify:track:a' } }, { item: { uri: 'spotify:track:b' } }],
                    next: 'https://api.spotify.com/v1/playlists/p1/items?offset=100',
                    total: 3
                })
                .mockResolvedValueOnce({
                    items: [{ item: { uri: 'spotify:track:c' } }],
                    next: null,
                    total: 3
                });

            const uris = await readPlaylistUris('user-1', 'p1');

            expect(spotifyFetch).toHaveBeenCalledTimes(2);
            expect(spotifyFetch).toHaveBeenNthCalledWith(1, 'user-1', '/v1/playlists/p1/items', {
                query: { fields: 'items(item(uri),track(uri)),next,total', limit: 100, offset: 0 }
            });
            expect(spotifyFetch).toHaveBeenNthCalledWith(2, 'user-1', '/v1/playlists/p1/items', {
                query: { fields: 'items(item(uri),track(uri)),next,total', limit: 100, offset: 100 }
            });
            expect(uris).toBeInstanceOf(Set);
            expect(uris).toEqual(new Set(['spotify:track:a', 'spotify:track:b', 'spotify:track:c']));
        });

        it('falls back to row.track.uri when row.item is absent (pre-migration shape)', async () => {
            spotifyFetch.mockResolvedValueOnce({
                items: [{ track: { uri: 'spotify:track:legacy' } }],
                next: null
            });

            const uris = await readPlaylistUris('user-1', 'p1');

            expect(uris).toEqual(new Set(['spotify:track:legacy']));
        });

        it('returns an empty Set for an empty playlist', async () => {
            spotifyFetch.mockResolvedValueOnce({ items: [], next: null });

            const uris = await readPlaylistUris('user-1', 'p1');

            expect(uris).toEqual(new Set());
        });

        it('stops after a single page when next is not present', async () => {
            spotifyFetch.mockResolvedValueOnce({
                items: [{ item: { uri: 'spotify:track:a' } }]
            });

            await readPlaylistUris('user-1', 'p1');

            expect(spotifyFetch).toHaveBeenCalledTimes(1);
        });
    });

    describe('addTracks', () => {
        it('skips a uri already in the playlist and reports it in skippedDuplicates', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ userId: 'user-1' });
            spotifyFetch
                .mockResolvedValueOnce({ items: [{ item: { uri: 'spotify:track:existing' } }], next: null })
                .mockResolvedValueOnce({ snapshot_id: 'snap-1' });

            const req = buildReq({ body: { uris: ['spotify:track:existing', 'spotify:track:new'] } });
            const res = buildRes();
            const next = jest.fn();

            await addTracks(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            const [payload] = res.json.mock.calls[0];
            expect(payload.added).toEqual(['spotify:track:new']);
            expect(payload.skippedDuplicates).toEqual(['spotify:track:existing']);
            expect(payload.failed).toEqual([]);
            expect(payload.snapshotId).toBe('snap-1');

            const writeCall = spotifyFetch.mock.calls[1];
            expect(writeCall[1]).toBe('/v1/playlists/playlist-1/items');
            expect(writeCall[2]).toMatchObject({
                method: 'POST',
                body: { uris: ['spotify:track:new'] },
                retryServerErrors: false
            });
        });

        it('writes a uri repeated twice in the same body only once', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ userId: 'user-1' });
            spotifyFetch
                .mockResolvedValueOnce({ items: [], next: null })
                .mockResolvedValueOnce({ snapshot_id: 'snap-1' });

            const req = buildReq({ body: { uris: ['spotify:track:a', 'spotify:track:a'] } });
            const res = buildRes();
            const next = jest.fn();

            await addTracks(req, res, next);

            const [payload] = res.json.mock.calls[0];
            expect(payload.added).toEqual(['spotify:track:a']);

            const writeCall = spotifyFetch.mock.calls[1];
            expect(writeCall[2].body).toEqual({ uris: ['spotify:track:a'] });
        });

        it('splits 150 new uris into two sequential batches of 100', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ userId: 'user-1' });
            const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);

            spotifyFetch
                .mockResolvedValueOnce({ items: [], next: null })
                .mockResolvedValueOnce({ snapshot_id: 'snap-a' })
                .mockResolvedValueOnce({ snapshot_id: 'snap-b' });

            const req = buildReq({ body: { uris } });
            const res = buildRes();
            const next = jest.fn();

            await addTracks(req, res, next);

            expect(spotifyFetch).toHaveBeenCalledTimes(3);
            expect(spotifyFetch.mock.calls[1][2].body.uris).toHaveLength(100);
            expect(spotifyFetch.mock.calls[2][2].body.uris).toHaveLength(50);

            const [payload] = res.json.mock.calls[0];
            expect(payload.added).toHaveLength(150);
            expect(payload.snapshotId).toBe('snap-b');
        });

        it('reports the second batch as failed while keeping the first as added', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ userId: 'user-1' });
            const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);

            spotifyFetch
                .mockResolvedValueOnce({ items: [], next: null })
                .mockResolvedValueOnce({ snapshot_id: 'snap-a' })
                .mockRejectedValueOnce(new Error('boom'));

            const req = buildReq({ body: { uris } });
            const res = buildRes();
            const next = jest.fn();

            await addTracks(req, res, next);

            const [payload] = res.json.mock.calls[0];
            expect(payload.added).toHaveLength(100);
            expect(payload.failed).toHaveLength(50);
            expect(payload.failed[0]).toEqual({ uri: 'spotify:track:100', reason: 'batch-failed' });
            expect(payload.snapshotId).toBe('snap-a');
        });

        it('forwards a 409 SPOTIFY_NOT_CONNECTED without calling Spotify when there is no account', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(null);

            const req = buildReq({ body: { uris: ['spotify:track:a'] } });
            const res = buildRes();
            const next = jest.fn();

            await addTracks(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 409,
                details: { code: 'SPOTIFY_NOT_CONNECTED' }
            }));
            expect(spotifyFetch).not.toHaveBeenCalled();
        });
    });
});
