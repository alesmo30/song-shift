const crypto = require('crypto');
const logger = require('../../utils/logger');
const SpotifyOAuthState = require('../../mongo/spotify-oauth-state-schema');
const { exchangeCodeForTokens, fetchSpotifyProfile, saveTokens } = require('./spotify.tokens');
const {
    SPOTIFY_SCOPES,
    SPOTIFY_ACCOUNTS_BASE_URL,
    OAUTH_STATE_TTL_MS
} = require('./const/spotify.constants');

const startOAuth = async (req, res, next) => {
    try {
        const { redirectPath } = req.body;
        const state = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS);

        await SpotifyOAuthState.create({
            state,
            user: req.user.id,
            redirectPath,
            expiresAt
        });

        const authorizeUrl = new URL(`${SPOTIFY_ACCOUNTS_BASE_URL}/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', process.env.SPOTIFY_CLIENT_ID);
        authorizeUrl.searchParams.set('scope', SPOTIFY_SCOPES.join(' '));
        authorizeUrl.searchParams.set('redirect_uri', process.env.SPOTIFY_REDIRECT_URI);
        authorizeUrl.searchParams.set('state', state);
        authorizeUrl.searchParams.set('show_dialog', 'false');

        logger.info(`[Spotify] OAuth flow started for user: ${req.user.id}`);

        return res.status(200).json({
            authorizeUrl: authorizeUrl.toString(),
            state,
            expiresAt: expiresAt.toISOString()
        });
    } catch (error) {
        logger.error(`[Spotify] Failed to start OAuth flow: ${error.message}`);
        next(error);
    }
};

const oauthCallback = async (req, res) => {
    const { code, state, error: spotifyError } = req.query;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const redirectWithError = (reason) => {
        const target = new URL('/', frontendUrl);
        target.searchParams.set('spotify', 'error');
        target.searchParams.set('reason', reason);
        return res.redirect(target.toString());
    };

    if (!state) {
        logger.error('[Spotify] OAuth callback received without a state parameter');
        return res.status(400).json({ status: 'error', message: 'Missing state parameter' });
    }

    if (spotifyError) {
        logger.error(`[Spotify] OAuth callback returned an error: ${spotifyError}`);
        return redirectWithError('access_denied');
    }

    const stateDoc = await SpotifyOAuthState.findOne({ state });

    if (!stateDoc) {
        logger.error('[Spotify] OAuth callback received an unknown state');
        return redirectWithError('invalid_state');
    }

    if (stateDoc.consumedAt) {
        logger.error(`[Spotify] OAuth callback received an already-consumed state for user: ${stateDoc.user}`);
        return redirectWithError('state_reused');
    }

    if (stateDoc.expiresAt.getTime() < Date.now()) {
        logger.error(`[Spotify] OAuth callback received an expired state for user: ${stateDoc.user}`);
        return redirectWithError('state_expired');
    }

    stateDoc.consumedAt = new Date();
    await stateDoc.save();

    let tokenResponse;
    try {
        tokenResponse = await exchangeCodeForTokens(code);
    } catch {
        logger.error(`[Spotify] Token exchange failed for user: ${stateDoc.user}`);
        return redirectWithError('token_exchange_failed');
    }

    let profile;
    try {
        profile = await fetchSpotifyProfile(tokenResponse.access_token);
    } catch {
        logger.error(`[Spotify] Failed to fetch Spotify profile for user: ${stateDoc.user}`);
        return redirectWithError('profile_fetch_failed');
    }

    try {
        await saveTokens(stateDoc.user, {
            spotifyUserId: profile.id,
            displayName: profile.display_name,
            email: profile.email,
            country: profile.country,
            product: profile.product,
            accessToken: tokenResponse.access_token,
            refreshToken: tokenResponse.refresh_token,
            expiresIn: tokenResponse.expires_in,
            scopes: tokenResponse.scope
        });
    } catch (error) {
        logger.error(`[Spotify] Failed to persist the Spotify account for user: ${stateDoc.user}: ${error.message}`);
        return redirectWithError('token_exchange_failed');
    }

    logger.info(`[Spotify] Account connected for user: ${stateDoc.user}`);

    const target = new URL(stateDoc.redirectPath || '/', frontendUrl);
    target.searchParams.set('spotify', 'connected');
    return res.redirect(target.toString());
};

module.exports = {
    startOAuth,
    oauthCallback
};
