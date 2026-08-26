const prisma = require('../../lib/prisma');
const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');
const { mapWithConcurrency } = require('../../utils/concurrency');
const { spotifyFetch } = require('./spotify.client');
const { normalizeTitle, normalizeArtist, pickBest } = require('./matching');

const SEARCH_CONCURRENCY = 5;

const requireAccount = async (userId) => {
    const account = await prisma.spotifyAccount.findUnique({ where: { userId } });

    if (!account) {
        throw new AppError('Spotify account not connected', 409, { code: 'SPOTIFY_NOT_CONNECTED' });
    }

    return account;
};

const buildQueries = (source, market) => {
    const { title: normTitle } = normalizeTitle(source.title);
    const normArtist = normalizeArtist(source.artist);
    const queries = [];

    if (source.isrc) {
        queries.push({ q: `isrc:${source.isrc}`, type: 'track', limit: 5 });
    }

    queries.push({ q: `track:"${normTitle}" artist:"${normArtist}"`, type: 'track', limit: 10, market });
    queries.push({ q: `${normTitle} ${normArtist}`.trim(), type: 'track', limit: 20, market });

    return queries;
};

const toCandidate = (track) => ({
    uri: track.uri,
    id: track.id,
    title: track.name,
    artists: (track.artists || []).map((artist) => artist.name),
    album: track.album?.name ?? null,
    durationMs: track.duration_ms ?? null,
    isrc: track.external_ids?.isrc ?? null,
    explicit: Boolean(track.explicit),
    popularity: track.popularity ?? 0,
    imageUrl: track.album?.images?.[0]?.url ?? null,
    previewUrl: track.preview_url ?? null,
    isCompilation: track.album?.album_type === 'compilation'
        || (track.album?.artists || []).some((artist) => artist.name === 'Various Artists')
});

const searchOnce = async (userId, query) => {
    const data = await spotifyFetch(userId, '/v1/search', { query });
    return data?.tracks?.items ?? [];
};

const matchOneSong = async (userId, market, song) => {
    const queries = buildQueries(song, market);
    let lastResult = { status: 'not_found', best: null, candidates: [] };

    for (const query of queries) {
        const items = await searchOnce(userId, query);
        if (!items.length) continue;

        lastResult = pickBest(song, items.map(toCandidate));
        if (lastResult.status !== 'not_found') return lastResult;
    }

    return lastResult;
};

const isGlobalSpotifyError = (error) => error instanceof AppError && (error.statusCode === 409 || error.statusCode === 429);

const matchTracks = async (req, res, next) => {
    try {
        const { songs } = req.body;
        const account = await requireAccount(req.user.id);

        let partial = false;

        const results = await mapWithConcurrency(songs, SEARCH_CONCURRENCY, async (song) => {
            try {
                const matchResult = await matchOneSong(req.user.id, account.country, song);
                return { sourceId: song.id, ...matchResult };
            } catch (error) {
                if (isGlobalSpotifyError(error)) throw error;

                partial = true;
                logger.error(`[Spotify] match failed for song ${song.id}: ${error.message}`);
                return { sourceId: song.id, status: 'not_found', best: null, candidates: [] };
            }
        });

        return res.status(200).json({ results, partial });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    buildQueries,
    matchTracks
};
