const crypto = require('crypto');
const logger = require('../../utils/logger');
const SpotifyOAuthState = require('../../mongo/spotify-oauth-state-schema');
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

module.exports = {
    startOAuth
};
