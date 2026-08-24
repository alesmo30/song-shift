const prisma = require('../../lib/prisma');
const logger = require('../../utils/logger');
const { encrypt, decrypt } = require('../../utils/crypto');
const { AuthenticationError } = require('../../utils/errors');
const {
    SPOTIFY_SCOPES,
    SPOTIFY_ACCOUNTS_BASE_URL,
    ACCESS_TOKEN_EXPIRY_MARGIN_MS
} = require('./const/spotify.constants');

// Evita que dos peticiones concurrentes con el token vencido disparen dos
// refrescos: la segunda espera a la promesa ya en vuelo de la primera.
const refreshPromises = new Map();

const saveTokens = async (userId, {
    spotifyUserId,
    displayName,
    email,
    country,
    product,
    accessToken,
    refreshToken,
    expiresIn,
    scopes
}) => {
    const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000 - ACCESS_TOKEN_EXPIRY_MARGIN_MS);

    const data = {
        spotifyUserId,
        displayName,
        email,
        country,
        product,
        accessTokenEnc: encrypt(accessToken),
        refreshTokenEnc: encrypt(refreshToken),
        accessTokenExpiresAt,
        scopes,
        needsReconnect: false
    };

    return prisma.spotifyAccount.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data
    });
};

const getDecryptedTokens = async (userId) => {
    const account = await prisma.spotifyAccount.findUnique({ where: { userId } });

    if (!account) {
        return null;
    }

    return {
        accessToken: decrypt(account.accessTokenEnc),
        refreshToken: decrypt(account.refreshTokenEnc),
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        needsReconnect: account.needsReconnect,
        scopes: account.scopes
    };
};

const doRefresh = async (userId) => {
    const account = await prisma.spotifyAccount.findUnique({ where: { userId } });

    if (!account) {
        throw new AuthenticationError('Spotify account not connected');
    }

    const refreshToken = decrypt(account.refreshTokenEnc);
    const basicAuth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');

    const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        })
    });

    const data = await response.json();

    if (!response.ok) {
        if (data.error === 'invalid_grant') {
            logger.error(`[Spotify] Refresh rejected with invalid_grant for user: ${userId}`);
            await prisma.spotifyAccount.update({
                where: { userId },
                data: { needsReconnect: true }
            });
        } else {
            logger.error(`[Spotify] Token refresh failed for user: ${userId}`);
        }

        throw new AuthenticationError('Failed to refresh Spotify token');
    }

    const accessTokenExpiresAt = new Date(Date.now() + data.expires_in * 1000 - ACCESS_TOKEN_EXPIRY_MARGIN_MS);

    const updateData = {
        accessTokenEnc: encrypt(data.access_token),
        accessTokenExpiresAt,
        needsReconnect: false
    };

    // Spotify no siempre devuelve un refresh_token nuevo: se conserva el
    // anterior cuando no viene uno en la respuesta.
    if (data.refresh_token) {
        updateData.refreshTokenEnc = encrypt(data.refresh_token);
    }

    await prisma.spotifyAccount.update({
        where: { userId },
        data: updateData
    });

    logger.info(`[Spotify] Access token refreshed for user: ${userId}`);

    return {
        accessToken: data.access_token,
        accessTokenExpiresAt
    };
};

const refreshAccessToken = (userId) => {
    if (refreshPromises.has(userId)) {
        return refreshPromises.get(userId);
    }

    const promise = doRefresh(userId).finally(() => {
        refreshPromises.delete(userId);
    });

    refreshPromises.set(userId, promise);
    return promise;
};

const hasRequiredScopes = (grantedScopes) => {
    const granted = new Set((grantedScopes || '').split(' ').filter(Boolean));
    return SPOTIFY_SCOPES.every((scope) => granted.has(scope));
};

module.exports = {
    saveTokens,
    getDecryptedTokens,
    refreshAccessToken,
    hasRequiredScopes
};
