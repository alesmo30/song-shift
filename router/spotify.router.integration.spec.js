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
    create: jest.fn()
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
