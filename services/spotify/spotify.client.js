const logger = require('../../utils/logger');
const { AppError, RateLimitError, ExternalServiceError } = require('../../utils/errors');
const { getDecryptedTokens, refreshAccessToken } = require('./spotify.tokens');
const { SPOTIFY_API_BASE_URL } = require('./const/spotify.constants');

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 8000;
const DEFAULT_RATE_LIMIT_WAIT_SECONDS = 1;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isExpired = (accessTokenExpiresAt) => (
    !accessTokenExpiresAt || new Date(accessTokenExpiresAt).getTime() <= Date.now()
);

const parseJson = async (response) => {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
};

const requestOnce = (accessToken, path, { method = 'GET', body, query }) => {
    const url = new URL(`${SPOTIFY_API_BASE_URL}${path}`);

    if (query) {
        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        });
    }

    return fetch(url.toString(), {
        method,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
};

const requestWithRateLimitRetry = async (accessToken, path, options) => {
    let response = await requestOnce(accessToken, path, options);
    let attempts = 0;

    while (response.status === 429 && attempts < MAX_RATE_LIMIT_RETRIES) {
        attempts += 1;

        const header = Number(response.headers.get('Retry-After'));
        const retryAfterSeconds = Number.isFinite(header) && header > 0 ? header : DEFAULT_RATE_LIMIT_WAIT_SECONDS;
        const waitMs = Math.min(retryAfterSeconds * 1000, MAX_RATE_LIMIT_WAIT_MS);

        logger.error(`[Spotify] 429 for ${path}, retrying in ${waitMs}ms (attempt ${attempts}/${MAX_RATE_LIMIT_RETRIES})`);
        await sleep(waitMs);

        response = await requestOnce(accessToken, path, options);
    }

    if (response.status === 429) {
        const header = Number(response.headers.get('Retry-After'));
        const retryAfterSeconds = Number.isFinite(header) && header > 0 ? header : undefined;

        logger.error(`[Spotify] 429 for ${path} exhausted after ${MAX_RATE_LIMIT_RETRIES} retries`);
        throw new RateLimitError('Spotify rate limit exceeded', retryAfterSeconds);
    }

    return response;
};

const spotifyFetch = async (userId, path, options = {}) => {
    const tokens = await getDecryptedTokens(userId);

    if (!tokens) {
        throw new AppError('Spotify account not connected', 409, { code: 'SPOTIFY_REAUTH_REQUIRED' });
    }

    let accessToken = tokens.accessToken;

    if (isExpired(tokens.accessTokenExpiresAt)) {
        ({ accessToken } = await refreshAccessToken(userId));
    }

    let response = await requestWithRateLimitRetry(accessToken, path, options);

    if (response.status === 401) {
        ({ accessToken } = await refreshAccessToken(userId));
        response = await requestWithRateLimitRetry(accessToken, path, options);

        if (response.status === 401) {
            logger.error(`[Spotify] Second consecutive 401 for user: ${userId}, path: ${path}`);
            throw new AppError('Spotify connection expired, please reconnect', 409, { code: 'SPOTIFY_REAUTH_REQUIRED' });
        }
    }

    if (response.status >= 500 && options.retryServerErrors === false) {
        logger.error(`[Spotify] ${response.status} for path: ${path}, not retrying (retryServerErrors: false)`);
        throw new ExternalServiceError('Spotify is unavailable');
    }

    if (response.status >= 500) {
        logger.error(`[Spotify] ${response.status} for path: ${path}, retrying once`);
        response = await requestWithRateLimitRetry(accessToken, path, options);

        if (response.status >= 500) {
            throw new ExternalServiceError('Spotify is unavailable');
        }
    }

    if (!response.ok) {
        const errorBody = await parseJson(response).catch(() => null);
        throw new AppError(errorBody?.error?.message || 'Spotify request failed', response.status);
    }

    if (response.status === 204) {
        return null;
    }

    return parseJson(response);
};

module.exports = {
    spotifyFetch
};
