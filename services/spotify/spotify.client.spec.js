const logger = require('../../utils/logger');
const { AppError, RateLimitError, ExternalServiceError } = require('../../utils/errors');
const spotifyTokens = require('./spotify.tokens');
const { spotifyFetch } = require('./spotify.client');

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn()
}));

jest.mock('./spotify.tokens', () => ({
    getDecryptedTokens: jest.fn(),
    refreshAccessToken: jest.fn()
}));

describe('services/spotify/spotify.client', () => {
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

    afterEach(() => {
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    it('throws 409 SPOTIFY_REAUTH_REQUIRED when there is no connected account', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(null);
        global.fetch = jest.fn();

        await expect(spotifyFetch('user-1', '/v1/me')).rejects.toMatchObject({
            statusCode: 409,
            details: { code: 'SPOTIFY_REAUTH_REQUIRED' }
        });

        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('happy path: returns the parsed JSON body', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 200, body: { id: 'me' } }));

        const result = await spotifyFetch('user-1', '/v1/me');

        expect(result).toEqual({ id: 'me' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.spotify.com/v1/me');
        expect(init.headers.Authorization).toBe('Bearer valid-access-token');
    });

    it('returns null for a 204 response', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 204 }));

        const result = await spotifyFetch('user-1', '/v1/playlists/abc/followers');

        expect(result).toBeNull();
    });

    it('refreshes proactively when the access token is already expired', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue({
            accessToken: 'stale-token',
            accessTokenExpiresAt: new Date(Date.now() - 1000)
        });
        spotifyTokens.refreshAccessToken.mockResolvedValue({ accessToken: 'fresh-token' });
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 200, body: {} }));

        await spotifyFetch('user-1', '/v1/me');

        expect(spotifyTokens.refreshAccessToken).toHaveBeenCalledWith('user-1');
        const [, init] = global.fetch.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer fresh-token');
    });

    it('recovers from a single 401 by refreshing and retrying once', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        spotifyTokens.refreshAccessToken.mockResolvedValue({ accessToken: 'refreshed-token' });
        global.fetch = jest.fn()
            .mockResolvedValueOnce(buildResponse({ status: 401 }))
            .mockResolvedValueOnce(buildResponse({ status: 200, body: { ok: true } }));

        const result = await spotifyFetch('user-1', '/v1/me');

        expect(result).toEqual({ ok: true });
        expect(spotifyTokens.refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        const [, secondInit] = global.fetch.mock.calls[1];
        expect(secondInit.headers.Authorization).toBe('Bearer refreshed-token');
    });

    it('does not loop on a second consecutive 401 and throws 409 SPOTIFY_REAUTH_REQUIRED', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        spotifyTokens.refreshAccessToken.mockResolvedValue({ accessToken: 'still-bad-token' });
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 401 }));

        await expect(spotifyFetch('user-1', '/v1/me')).rejects.toMatchObject({
            statusCode: 409,
            details: { code: 'SPOTIFY_REAUTH_REQUIRED' }
        });

        expect(spotifyTokens.refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('retries after a 429 honoring a positive Retry-After and eventually succeeds', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn()
            .mockResolvedValueOnce(buildResponse({ status: 429, headers: { 'Retry-After': '1' } }))
            .mockResolvedValueOnce(buildResponse({ status: 200, body: { ok: true } }));

        const result = await spotifyFetch('user-1', '/v1/search');

        expect(result).toEqual({ ok: true });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws RateLimitError carrying retryAfter after exhausting retries on a sustained 429', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 429, headers: { 'Retry-After': '1' } }));

        const error = await spotifyFetch('user-1', '/v1/search').catch((e) => e);

        expect(error).toBeInstanceOf(RateLimitError);
        expect(error.retryAfter).toBe(1);
        expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('defaults the rate-limit wait when Retry-After is missing or invalid', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn()
            .mockResolvedValueOnce(buildResponse({ status: 429 }))
            .mockResolvedValueOnce(buildResponse({ status: 200, body: {} }));

        await spotifyFetch('user-1', '/v1/search');

        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('parses an empty successful body as null', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 200 }));

        const result = await spotifyFetch('user-1', '/v1/me');

        expect(result).toBeNull();
    });

    it('retries once on a 5xx and returns the successful retry', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn()
            .mockResolvedValueOnce(buildResponse({ status: 502 }))
            .mockResolvedValueOnce(buildResponse({ status: 200, body: { ok: true } }));

        const result = await spotifyFetch('user-1', '/v1/me');

        expect(result).toEqual({ ok: true });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws ExternalServiceError when the retried 5xx also fails', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 503 }));

        await expect(spotifyFetch('user-1', '/v1/me')).rejects.toThrow(ExternalServiceError);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 5xx when retryServerErrors is false, and throws ExternalServiceError immediately', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 502 }));

        await expect(spotifyFetch('user-1', '/v1/me', { retryServerErrors: false })).rejects.toThrow(ExternalServiceError);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('throws an AppError with the Spotify status for other non-ok responses', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(
            buildResponse({ status: 403, body: { error: { message: 'Insufficient client scope' } } })
        );

        await expect(spotifyFetch('user-1', '/v1/me')).rejects.toMatchObject({
            statusCode: 403,
            message: 'Insufficient client scope'
        });
    });

    it('falls back to a generic message when the error body cannot be parsed', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue({
            status: 400,
            ok: false,
            headers: { get: () => null },
            text: async () => 'not-json'
        });

        await expect(spotifyFetch('user-1', '/v1/me')).rejects.toMatchObject({
            statusCode: 400,
            message: 'Spotify request failed'
        });
    });

    it('sends a JSON body and Content-Type for write requests', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 200, body: {} }));

        await spotifyFetch('user-1', '/v1/playlists', {
            method: 'POST',
            body: { name: 'My Playlist' }
        });

        const [, init] = global.fetch.mock.calls[0];
        expect(init.method).toBe('POST');
        expect(init.headers['Content-Type']).toBe('application/json');
        expect(init.body).toBe(JSON.stringify({ name: 'My Playlist' }));
    });

    it('appends query params to the URL, skipping null and undefined values', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 200, body: {} }));

        await spotifyFetch('user-1', '/v1/search', {
            query: { q: 'test', limit: 10, market: undefined, offset: null }
        });

        const [url] = global.fetch.mock.calls[0];
        expect(url).toBe('https://api.spotify.com/v1/search?q=test&limit=10');
    });

    it('never logs the access token', async () => {
        spotifyTokens.getDecryptedTokens.mockResolvedValue(validTokens);
        global.fetch = jest.fn().mockResolvedValue(buildResponse({ status: 429, headers: { 'Retry-After': '0' } }));

        await expect(spotifyFetch('user-1', '/v1/search')).rejects.toThrow(RateLimitError);

        const allLoggedText = [...logger.error.mock.calls, ...logger.info.mock.calls]
            .flat()
            .join(' ');
        expect(allLoggedText).not.toContain('valid-access-token');
    });
});
