const prisma = require('../../lib/prisma');
const logger = require('../../utils/logger');
const { encrypt, decrypt } = require('../../utils/crypto');
const { AuthenticationError } = require('../../utils/errors');
const {
    exchangeCodeForTokens,
    fetchSpotifyProfile,
    saveTokens,
    getDecryptedTokens,
    refreshAccessToken,
    hasRequiredScopes
} = require('./spotify.tokens');

jest.mock('../../lib/prisma', () => ({
    spotifyAccount: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn()
    }
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn()
}));

describe('services/spotify/spotify.tokens', () => {
    const originalEncKey = process.env.SPOTIFY_TOKEN_ENC_KEY;
    const originalClientId = process.env.SPOTIFY_CLIENT_ID;
    const originalClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    beforeAll(() => {
        process.env.SPOTIFY_TOKEN_ENC_KEY = require('crypto').randomBytes(32).toString('base64');
        process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
        process.env.SPOTIFY_CLIENT_SECRET = 'test-client-secret';
    });

    afterAll(() => {
        process.env.SPOTIFY_TOKEN_ENC_KEY = originalEncKey;
        process.env.SPOTIFY_CLIENT_ID = originalClientId;
        process.env.SPOTIFY_CLIENT_SECRET = originalClientSecret;
    });

    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe('exchangeCodeForTokens', () => {
        it('exchanges an authorization code for tokens', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'access-value',
                    refresh_token: 'refresh-value',
                    expires_in: 3600,
                    scope: 'user-read-email'
                })
            });

            const result = await exchangeCodeForTokens('auth-code-123');

            expect(result.access_token).toBe('access-value');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/token'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        Authorization: expect.stringContaining('Basic ')
                    })
                })
            );
            global.fetch = originalFetch;
        });

        it('throws AuthenticationError when the exchange fails', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'invalid_grant' })
            });

            await expect(exchangeCodeForTokens('bad-code')).rejects.toThrow(AuthenticationError);
            global.fetch = originalFetch;
        });
    });

    describe('fetchSpotifyProfile', () => {
        it('returns the profile when the request succeeds', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ id: 'spotify-user-1', display_name: 'Jane' })
            });

            const result = await fetchSpotifyProfile('access-token-value');

            expect(result.id).toBe('spotify-user-1');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/v1/me'),
                expect.objectContaining({
                    headers: { Authorization: 'Bearer access-token-value' }
                })
            );
            global.fetch = originalFetch;
        });

        it('throws AuthenticationError when the profile request fails', async () => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'invalid_token' })
            });

            await expect(fetchSpotifyProfile('bad-token')).rejects.toThrow(AuthenticationError);
            global.fetch = originalFetch;
        });
    });

    describe('saveTokens', () => {
        it('encrypts both tokens and upserts by userId', async () => {
            prisma.spotifyAccount.upsert.mockResolvedValue({ id: 'account-1' });

            await saveTokens('user-1', {
                spotifyUserId: 'spotify-user-1',
                displayName: 'Jane',
                email: 'jane@example.com',
                country: 'US',
                product: 'premium',
                accessToken: 'access-token-value',
                refreshToken: 'refresh-token-value',
                expiresIn: 3600,
                scopes: 'user-read-email'
            });

            expect(prisma.spotifyAccount.upsert).toHaveBeenCalledTimes(1);
            const call = prisma.spotifyAccount.upsert.mock.calls[0][0];

            expect(call.where).toEqual({ userId: 'user-1' });
            expect(call.create.userId).toBe('user-1');
            expect(call.create.accessTokenEnc).not.toBe('access-token-value');
            expect(decrypt(call.create.accessTokenEnc)).toBe('access-token-value');
            expect(decrypt(call.create.refreshTokenEnc)).toBe('refresh-token-value');
            expect(call.update.needsReconnect).toBe(false);
        });
    });

    describe('getDecryptedTokens', () => {
        it('returns null when there is no account', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(null);

            const result = await getDecryptedTokens('user-1');

            expect(result).toBeNull();
        });

        it('decrypts both tokens for an existing account', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue({
                accessTokenEnc: encrypt('access-value'),
                refreshTokenEnc: encrypt('refresh-value'),
                accessTokenExpiresAt: new Date('2026-01-01'),
                needsReconnect: false,
                scopes: 'user-read-email'
            });

            const result = await getDecryptedTokens('user-1');

            expect(result.accessToken).toBe('access-value');
            expect(result.refreshToken).toBe('refresh-value');
            expect(result.needsReconnect).toBe(false);
        });
    });

    describe('refreshAccessToken', () => {
        const buildAccount = () => ({
            accessTokenEnc: encrypt('old-access'),
            refreshTokenEnc: encrypt('old-refresh')
        });

        it('throws AuthenticationError when there is no account to refresh', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(null);

            await expect(refreshAccessToken('user-1')).rejects.toThrow(AuthenticationError);
        });

        it('refreshes the access token and persists the new expiry', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(buildAccount());
            prisma.spotifyAccount.update.mockResolvedValue({});
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'new-access',
                    expires_in: 3600
                })
            });

            const result = await refreshAccessToken('user-1');

            expect(result.accessToken).toBe('new-access');
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/token'),
                expect.objectContaining({ method: 'POST' })
            );

            const updateCall = prisma.spotifyAccount.update.mock.calls[0][0];
            expect(decrypt(updateCall.data.accessTokenEnc)).toBe('new-access');
            expect(updateCall.data.refreshTokenEnc).toBeUndefined();
            expect(updateCall.data.needsReconnect).toBe(false);
            expect(logger.info).toHaveBeenCalled();
        });

        it('persists a new refresh token when Spotify returns one', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(buildAccount());
            prisma.spotifyAccount.update.mockResolvedValue({});
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    access_token: 'new-access',
                    refresh_token: 'new-refresh',
                    expires_in: 3600
                })
            });

            await refreshAccessToken('user-2');

            const updateCall = prisma.spotifyAccount.update.mock.calls[0][0];
            expect(decrypt(updateCall.data.refreshTokenEnc)).toBe('new-refresh');
        });

        it('marks needsReconnect and throws on invalid_grant', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(buildAccount());
            prisma.spotifyAccount.update.mockResolvedValue({});
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'invalid_grant' })
            });

            await expect(refreshAccessToken('user-3')).rejects.toThrow(AuthenticationError);

            const updateCall = prisma.spotifyAccount.update.mock.calls[0][0];
            expect(updateCall.data).toEqual({ needsReconnect: true });
        });

        it('throws without marking needsReconnect on other refresh failures', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(buildAccount());
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                json: async () => ({ error: 'server_error' })
            });

            await expect(refreshAccessToken('user-4')).rejects.toThrow(AuthenticationError);

            expect(prisma.spotifyAccount.update).not.toHaveBeenCalled();
        });

        it('shares a single in-flight refresh across concurrent callers', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(buildAccount());
            prisma.spotifyAccount.update.mockResolvedValue({});
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ access_token: 'new-access', expires_in: 3600 })
            });

            const [first, second] = await Promise.all([
                refreshAccessToken('user-5'),
                refreshAccessToken('user-5')
            ]);

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(first).toBe(second);
        });

        it('allows a fresh refresh after the previous one settles', async () => {
            prisma.spotifyAccount.findUnique.mockResolvedValue(buildAccount());
            prisma.spotifyAccount.update.mockResolvedValue({});
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ access_token: 'new-access', expires_in: 3600 })
            });

            await refreshAccessToken('user-6');
            await refreshAccessToken('user-6');

            expect(global.fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('hasRequiredScopes', () => {
        it('returns true when all required scopes are granted', () => {
            const granted = 'playlist-read-private playlist-modify-private playlist-modify-public user-read-private user-read-email extra-scope';

            expect(hasRequiredScopes(granted)).toBe(true);
        });

        it('returns false when a required scope is missing', () => {
            expect(hasRequiredScopes('user-read-email')).toBe(false);
        });

        it('returns false for an empty or undefined scopes string', () => {
            expect(hasRequiredScopes('')).toBe(false);
            expect(hasRequiredScopes(undefined)).toBe(false);
        });
    });
});
