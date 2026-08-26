const { spotifyFetch } = require('./spotify.client');

const PAGE_LIMIT = 100;
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

module.exports = {
    readPlaylistUris
};
