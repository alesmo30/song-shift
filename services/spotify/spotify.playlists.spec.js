const prisma = require('../../lib/prisma');
const spotifyTokens = require('./spotify.tokens');
const { RateLimitError } = require('../../utils/errors');
const { listPlaylists, createPlaylist, setDefaultPlaylist } = require('./spotify.playlists');

jest.mock('../../lib/prisma', () => ({
    spotifyAccount: {
        findUnique: jest.fn(),
        update: jest.fn()
    }
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn()
}));

jest.mock('./spotify.tokens', () => ({
    getDecryptedTokens: jest.fn(),
    refreshAccessToken: jest.fn()
}));

describe('services/spotify/spotify.playlists', () => {
    const originalFetch = global.fetch;

    const buildResponse = ({ status, body = null, headers = {} }) => ({
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get: (name) => headers[name] ?? null
        },
        text: async () => (body === null ? '' : JSON.stringify(body))
    });

    const validTokens = {
        accessToken: 'valid-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    };

    const buildReq = (overrides = {}) => ({
        user: { id: 'user-1' },
        query: {},
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
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    describe('listPlaylists', () => {
        it('returns an empty list when Spotify has no playlists', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ spotifyUserId: 'spotify-user-1' });
            spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
            global.fetch = jest.fn().mockResolvedValue(buildResponse({
                status: 200,
                body: { items: [], total: 0, limit: 20, offset: 0 }
            }));

            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await listPlaylists(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ items: [], total: 0, limit: 20, offset: 0 });
        });

        it('filters out playlists that are not owned by the authenticated Spotify user', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ spotifyUserId: 'spotify-user-1' });
            spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
            global.fetch = jest.fn().mockResolvedValue(buildResponse({
                status: 200,
                body: {
                    items: [
                        {
                            id: 'mine',
                            name: 'Mine',
                            public: false,
                            images: [],
                            external_urls: { spotify: 'https://open.spotify.com/playlist/mine' },
                            owner: { id: 'spotify-user-1' },
                            tracks: { total: 2 }
                        },
                        {
                            id: 'someone-elses',
                            name: 'Not mine',
                            public: true,
                            images: [],
                            external_urls: { spotify: 'https://open.spotify.com/playlist/someone-elses' },
                            owner: { id: 'other-user' },
                            tracks: { total: 5 }
                        }
                    ],
                    total: 2,
                    limit: 20,
                    offset: 0
                }
            }));

            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await listPlaylists(req, res, next);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                items: [expect.objectContaining({ id: 'mine' })],
                total: 2
            }));
        });

        it('forwards a 409 SPOTIFY_REAUTH_REQUIRED to the error handler when there is no connected account', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(null);
            spotifyTokens.getDecryptedTokens.mockResolvedValue(null);
            global.fetch = jest.fn();

            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await listPlaylists(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.objectContaining({
                statusCode: 409,
                details: { code: 'SPOTIFY_REAUTH_REQUIRED' }
            }));
            expect(res.json).not.toHaveBeenCalled();
        });

        it('forwards a RateLimitError with Retry-After to the error handler', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({ spotifyUserId: 'spotify-user-1' });
            spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
            global.fetch = jest.fn().mockResolvedValue(buildResponse({
                status: 429,
                headers: { 'Retry-After': '2' }
            }));

            const req = buildReq();
            const res = buildRes();
            const next = jest.fn();

            await listPlaylists(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(RateLimitError));
            expect(next.mock.calls[0][0].retryAfter).toBe(2);
        });
    });

    describe('createPlaylist', () => {
        it('creates the playlist as private and returns the mapped DTO', async () => {
            spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
            global.fetch = jest.fn().mockResolvedValue(buildResponse({
                status: 200,
                body: {
                    id: 'new-playlist',
                    name: 'My Playlist',
                    public: false,
                    images: [],
                    external_urls: { spotify: 'https://open.spotify.com/playlist/new-playlist' }
                }
            }));

            const req = buildReq({ body: { name: 'My Playlist' } });
            const res = buildRes();
            const next = jest.fn();

            await createPlaylist(req, res, next);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-playlist', public: false }));

            const [, init] = global.fetch.mock.calls[0];
            expect(JSON.parse(init.body)).toEqual({ name: 'My Playlist', public: false });
        });
    });

    describe('setDefaultPlaylist', () => {
        it('saves the playlistId', async () => {
            prisma.spotifyAccount.update.mockResolvedValue({});

            const req = buildReq({ body: { playlistId: 'playlist-id' } });
            const res = buildRes();
            const next = jest.fn();

            await setDefaultPlaylist(req, res, next);

            expect(prisma.spotifyAccount.update).toHaveBeenCalledWith({
                where: { userId: 'user-1' },
                data: { defaultPlaylistId: 'playlist-id' }
            });
            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ defaultPlaylistId: 'playlist-id' });
        });

        it('clears the playlistId when sent null', async () => {
            prisma.spotifyAccount.update.mockResolvedValue({});

            const req = buildReq({ body: { playlistId: null } });
            const res = buildRes();
            const next = jest.fn();

            await setDefaultPlaylist(req, res, next);

            expect(prisma.spotifyAccount.update).toHaveBeenCalledWith({
                where: { userId: 'user-1' },
                data: { defaultPlaylistId: null }
            });
            expect(res.json).toHaveBeenCalledWith({ defaultPlaylistId: null });
        });
    });
});
