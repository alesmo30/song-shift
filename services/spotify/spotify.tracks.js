const { chunk } = require('lodash');
const prisma = require('../../lib/prisma');
const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');
const { spotifyFetch } = require('./spotify.client');

const PAGE_LIMIT = 100;
const WRITE_BATCH_SIZE = 100;
const ITEMS_FIELDS = 'items(item(uri),track(uri)),next,total';

const readPlaylistUris = async (userId, playlistId) => {
    const uris = new Set();
    let offset = 0;
    let hasNext = true;

    while (hasNext) {
        const data = await spotifyFetch(userId, `/v1/playlists/${playlistId}/items`, {
            query: { fields: ITEMS_FIELDS, limit: PAGE_LIMIT, offset }
        });

        (data?.items ?? []).forEach((row) => {
            const uri = row.item?.uri ?? row.track?.uri;
            if (uri) uris.add(uri);
        });

        hasNext = Boolean(data?.next);
        offset += PAGE_LIMIT;
    }

    return uris;
};

const requireAccount = async (userId) => {
    const account = await prisma.spotifyAccount.findUnique({ where: { userId } });

    if (!account) {
        throw new AppError('Spotify account not connected', 409, { code: 'SPOTIFY_NOT_CONNECTED' });
    }

    return account;
};

const partitionByDuplicates = (uris, existingUris) => {
    const skippedDuplicates = [];
    const seenInBatch = new Set();
    const toWrite = [];

    uris.forEach((uri) => {
        if (existingUris.has(uri)) {
            skippedDuplicates.push(uri);
            return;
        }

        if (seenInBatch.has(uri)) return;

        seenInBatch.add(uri);
        toWrite.push(uri);
    });

    return { toWrite, skippedDuplicates };
};

const addTracks = async (req, res, next) => {
    try {
        const { playlistId } = req.params;
        const { uris } = req.body;

        await requireAccount(req.user.id);

        const existingUris = await readPlaylistUris(req.user.id, playlistId);
        const { toWrite, skippedDuplicates } = partitionByDuplicates(uris, existingUris);

        const added = [];
        const failed = [];
        let snapshotId = null;

        for (const batch of chunk(toWrite, WRITE_BATCH_SIZE)) {
            try {
                const data = await spotifyFetch(req.user.id, `/v1/playlists/${playlistId}/items`, {
                    method: 'POST',
                    body: { uris: batch },
                    retryServerErrors: false
                });

                added.push(...batch);
                snapshotId = data?.snapshot_id ?? snapshotId;
            } catch (error) {
                logger.error(`[Spotify] batch write failed for playlist ${playlistId}: ${error.message}`);
                batch.forEach((uri) => failed.push({ uri, reason: 'batch-failed' }));
            }
        }

        return res.status(200).json({ added, skippedDuplicates, failed, snapshotId });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    readPlaylistUris,
    addTracks
};
