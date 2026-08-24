const request = require('supertest');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const SpotifyOAuthState = require('../mongo/spotify-oauth-state-schema');
const server = require('../server');

jest.mock('../lib/prisma', () => ({
    user: {
        findUnique: jest.fn()
    }
}));

jest.mock('../mongo/spotify-oauth-state-schema', () => ({
    create: jest.fn(),
    findOne: jest.fn()
}));

jest.mock('../services/spotify/spotify.tokens', () => ({
    exchangeCodeForTokens: jest.fn(),
    fetchSpotifyProfile: jest.fn(),
    saveTokens: jest.fn()
}));

describe('POST /spotify/auth-url (integration)', () => {
    const originalClientId = process.env.SPOTIFY_CLIENT_ID;
    const originalRedirectUri = process.env.SPOTIFY_REDIRECT_URI;

    const testUser = { id: 'user-1', email: 'jane@example.com', role: 'USER' };

    const buildAccessToken = () => jwt.sign(
        { email: testUser.email },
        process.env.JWT_ACCESS_TOKEN_SECRET,
        { expiresIn: '1h' }
    );

    beforeAll(() => {
        process.env.SPOTIFY_CLIENT_ID = 'test-client-id';
        process.env.SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:3000/spotify/callback';
    });

    afterAll(() => {
        process.env.SPOTIFY_CLIENT_ID = originalClientId;
        process.env.SPOTIFY_REDIRECT_URI = originalRedirectUri;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        prisma.user.findUnique.mockResolvedValue(testUser);
        SpotifyOAuthState.create.mockResolvedValue({});
    });

    it('returns 401 without a JWT', async () => {
        const response = await request(server).post('/spotify/auth-url').send({});

        expect(response.status).toBe(401);
        expect(SpotifyOAuthState.create).not.toHaveBeenCalled();
    });

    it('returns 200 with an authorizeUrl carrying the five scopes and the correct redirect_uri', async () => {
        const response = await request(server)
            .post('/spotify/auth-url')
            .set('Authorization', `Bearer ${buildAccessToken()}`)
            .send({});

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('state');
        expect(response.body).toHaveProperty('expiresAt');

        const url = new URL(response.body.authorizeUrl);
        expect(url.origin).toBe('https://accounts.spotify.com');
        expect(url.pathname).toBe('/authorize');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('client_id')).toBe('test-client-id');
        expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3000/spotify/callback');
        expect(url.searchParams.get('state')).toBe(response.body.state);

        const scopes = url.searchParams.get('scope').split(' ');
        expect(scopes).toEqual([
            'playlist-read-private',
            'playlist-modify-private',
            'playlist-modify-public',
            'user-read-private',
            'user-read-email'
        ]);
    });

    it('persists the OAuth state bound to the authenticated user', async () => {
        await request(server)
            .post('/spotify/auth-url')
            .set('Authorization', `Bearer ${buildAccessToken()}`)
            .send({ redirectPath: '/dashboard' });

        expect(SpotifyOAuthState.create).toHaveBeenCalledTimes(1);
        const call = SpotifyOAuthState.create.mock.calls[0][0];
        expect(call.user).toBe('user-1');
        expect(call.redirectPath).toBe('/dashboard');
        expect(call.state).toEqual(expect.any(String));
        expect(call.expiresAt).toBeInstanceOf(Date);
    });

    it('returns 400 when redirectPath fails validation', async () => {
        const response = await request(server)
            .post('/spotify/auth-url')
            .set('Authorization', `Bearer ${buildAccessToken()}`)
            .send({ redirectPath: '//evil.com' });

        expect(response.status).toBe(400);
        expect(SpotifyOAuthState.create).not.toHaveBeenCalled();
    });

    it('forwards unexpected errors to the error handler', async () => {
        SpotifyOAuthState.create.mockRejectedValue(new Error('mongo down'));

        const response = await request(server)
            .post('/spotify/auth-url')
            .set('Authorization', `Bearer ${buildAccessToken()}`)
            .send({});

        expect(response.status).toBe(500);
    });
});

describe('GET /spotify/callback (integration)', () => {
    const spotifyTokens = require('../services/spotify/spotify.tokens');
    const SpotifyOAuthState = require('../mongo/spotify-oauth-state-schema');
    const originalFrontendUrl = process.env.FRONTEND_URL;

    const buildStateDoc = (overrides = {}) => ({
        state: 'state-abc',
        user: 'user-1',
        redirectPath: '/dashboard',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        consumedAt: null,
        save: jest.fn().mockResolvedValue(true),
        ...overrides
    });

    beforeAll(() => {
        process.env.FRONTEND_URL = 'http://localhost:5173';
    });

    afterAll(() => {
        process.env.FRONTEND_URL = originalFrontendUrl;
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns 400 JSON when the state parameter is missing', async () => {
        const response = await request(server).get('/spotify/callback').query({ code: 'abc' });

        expect(response.status).toBe(400);
        expect(response.body.status).toBe('error');
        expect(SpotifyOAuthState.findOne).not.toHaveBeenCalled();
    });

    it('redirects with reason=access_denied when Spotify reports an error', async () => {
        const response = await request(server)
            .get('/spotify/callback')
            .query({ error: 'access_denied', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=access_denied');
        expect(SpotifyOAuthState.findOne).not.toHaveBeenCalled();
    });

    it('redirects with reason=invalid_state for an unknown state', async () => {
        SpotifyOAuthState.findOne.mockResolvedValue(null);

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'unknown-state' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=invalid_state');
    });

    it('redirects with reason=state_reused for an already-consumed state', async () => {
        SpotifyOAuthState.findOne.mockResolvedValue(buildStateDoc({ consumedAt: new Date() }));

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=state_reused');
    });

    it('redirects with reason=state_expired for an expired state', async () => {
        SpotifyOAuthState.findOne.mockResolvedValue(
            buildStateDoc({ expiresAt: new Date(Date.now() - 1000) })
        );

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=state_expired');
    });

    it('redirects with reason=token_exchange_failed when the code exchange fails', async () => {
        const stateDoc = buildStateDoc();
        SpotifyOAuthState.findOne.mockResolvedValue(stateDoc);
        spotifyTokens.exchangeCodeForTokens.mockRejectedValue(new Error('bad code'));

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=token_exchange_failed');
        expect(stateDoc.save).toHaveBeenCalledTimes(1);
        expect(stateDoc.consumedAt).toBeInstanceOf(Date);
    });

    it('redirects with reason=profile_fetch_failed when fetching the profile fails', async () => {
        const stateDoc = buildStateDoc();
        SpotifyOAuthState.findOne.mockResolvedValue(stateDoc);
        spotifyTokens.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'access-value',
            refresh_token: 'refresh-value',
            expires_in: 3600,
            scope: 'user-read-email'
        });
        spotifyTokens.fetchSpotifyProfile.mockRejectedValue(new Error('bad token'));

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=profile_fetch_failed');
    });

    it('redirects with reason=token_exchange_failed when persisting the account fails', async () => {
        const stateDoc = buildStateDoc();
        SpotifyOAuthState.findOne.mockResolvedValue(stateDoc);
        spotifyTokens.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'access-value',
            refresh_token: 'refresh-value',
            expires_in: 3600,
            scope: 'user-read-email'
        });
        spotifyTokens.fetchSpotifyProfile.mockResolvedValue({ id: 'spotify-user-1' });
        spotifyTokens.saveTokens.mockRejectedValue(new Error('db down'));

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=token_exchange_failed');
    });

    it('on success, marks the state consumed, saves the account, and redirects to redirectPath with spotify=connected', async () => {
        const stateDoc = buildStateDoc({ redirectPath: '/dashboard' });
        SpotifyOAuthState.findOne.mockResolvedValue(stateDoc);
        spotifyTokens.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'access-value',
            refresh_token: 'refresh-value',
            expires_in: 3600,
            scope: 'user-read-email playlist-read-private'
        });
        spotifyTokens.fetchSpotifyProfile.mockResolvedValue({
            id: 'spotify-user-1',
            display_name: 'Jane',
            email: 'jane@spotify.com',
            country: 'US',
            product: 'premium'
        });
        spotifyTokens.saveTokens.mockResolvedValue({});

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'auth-code-xyz', state: 'state-abc' });

        expect(response.status).toBe(302);
        expect(response.headers.location).toBe('http://localhost:5173/dashboard?spotify=connected');

        expect(stateDoc.consumedAt).toBeInstanceOf(Date);
        expect(stateDoc.save).toHaveBeenCalledTimes(1);

        expect(spotifyTokens.saveTokens).toHaveBeenCalledWith('user-1', {
            spotifyUserId: 'spotify-user-1',
            displayName: 'Jane',
            email: 'jane@spotify.com',
            country: 'US',
            product: 'premium',
            accessToken: 'access-value',
            refreshToken: 'refresh-value',
            expiresIn: 3600,
            scopes: 'user-read-email playlist-read-private'
        });
    });

    it('defaults to the root path when the state has no redirectPath', async () => {
        const stateDoc = buildStateDoc({ redirectPath: null });
        SpotifyOAuthState.findOne.mockResolvedValue(stateDoc);
        spotifyTokens.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'access-value',
            refresh_token: 'refresh-value',
            expires_in: 3600,
            scope: 'user-read-email'
        });
        spotifyTokens.fetchSpotifyProfile.mockResolvedValue({ id: 'spotify-user-1' });
        spotifyTokens.saveTokens.mockResolvedValue({});

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'auth-code-xyz', state: 'state-abc' });

        expect(response.headers.location).toBe('http://localhost:5173/?spotify=connected');
    });

    it('falls back to http://localhost:5173 when FRONTEND_URL is unset', async () => {
        delete process.env.FRONTEND_URL;
        SpotifyOAuthState.findOne.mockResolvedValue(null);

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'abc', state: 'unknown-state' });

        expect(response.headers.location).toBe('http://localhost:5173/?spotify=error&reason=invalid_state');

        process.env.FRONTEND_URL = 'http://localhost:5173';
    });

    it('never leaks the authorization code or tokens in the redirect Location header', async () => {
        const stateDoc = buildStateDoc();
        SpotifyOAuthState.findOne.mockResolvedValue(stateDoc);
        spotifyTokens.exchangeCodeForTokens.mockResolvedValue({
            access_token: 'super-secret-access-token',
            refresh_token: 'super-secret-refresh-token',
            expires_in: 3600,
            scope: 'user-read-email'
        });
        spotifyTokens.fetchSpotifyProfile.mockResolvedValue({ id: 'spotify-user-1' });
        spotifyTokens.saveTokens.mockResolvedValue({});

        const response = await request(server)
            .get('/spotify/callback')
            .query({ code: 'super-secret-auth-code', state: 'state-abc' });

        expect(response.headers.location).not.toContain('super-secret-auth-code');
        expect(response.headers.location).not.toContain('super-secret-access-token');
        expect(response.headers.location).not.toContain('super-secret-refresh-token');
    });
});
