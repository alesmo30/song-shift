const { spotifyFetch } = require('./spotify.client');
const { readPlaylistUris } = require('./spotify.tracks');

jest.mock('./spotify.client', () => ({
    spotifyFetch: jest.fn()
}));

describe('services/spotify/spotify.tracks', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('readPlaylistUris', () => {
        it('pages through the playlist until next is exhausted and returns a Set of uris', async () => {
            spotifyFetch
                .mockResolvedValueOnce({
                    items: [{ item: { uri: 'spotify:track:a' } }, { item: { uri: 'spotify:track:b' } }],
                    next: 'https://api.spotify.com/v1/playlists/p1/items?offset=100',
                    total: 3
                })
                .mockResolvedValueOnce({
                    items: [{ item: { uri: 'spotify:track:c' } }],
                    next: null,
                    total: 3
                });

            const uris = await readPlaylistUris('user-1', 'p1');

            expect(spotifyFetch).toHaveBeenCalledTimes(2);
            expect(spotifyFetch).toHaveBeenNthCalledWith(1, 'user-1', '/v1/playlists/p1/items', {
                query: { fields: 'items(item(uri),track(uri)),next,total', limit: 100, offset: 0 }
            });
            expect(spotifyFetch).toHaveBeenNthCalledWith(2, 'user-1', '/v1/playlists/p1/items', {
                query: { fields: 'items(item(uri),track(uri)),next,total', limit: 100, offset: 100 }
            });
            expect(uris).toBeInstanceOf(Set);
            expect(uris).toEqual(new Set(['spotify:track:a', 'spotify:track:b', 'spotify:track:c']));
        });

        it('falls back to row.track.uri when row.item is absent (pre-migration shape)', async () => {
            spotifyFetch.mockResolvedValueOnce({
                items: [{ track: { uri: 'spotify:track:legacy' } }],
                next: null
            });

            const uris = await readPlaylistUris('user-1', 'p1');

            expect(uris).toEqual(new Set(['spotify:track:legacy']));
        });

        it('returns an empty Set for an empty playlist', async () => {
            spotifyFetch.mockResolvedValueOnce({ items: [], next: null });

            const uris = await readPlaylistUris('user-1', 'p1');

            expect(uris).toEqual(new Set());
        });

        it('stops after a single page when next is not present', async () => {
            spotifyFetch.mockResolvedValueOnce({
                items: [{ item: { uri: 'spotify:track:a' } }]
            });

            await readPlaylistUris('user-1', 'p1');

            expect(spotifyFetch).toHaveBeenCalledTimes(1);
        });
    });
});
