const { toPlaylistDTO } = require('./playlist.mapper');

describe('services/spotify/playlist.mapper', () => {
    const basePlaylist = {
        id: 'playlist-id',
        name: 'My Playlist',
        description: 'A description',
        public: false,
        images: [{ url: 'https://example.com/image.png' }],
        external_urls: { spotify: 'https://open.spotify.com/playlist/playlist-id' }
    };

    it('reads trackCount from items.total when present', () => {
        const dto = toPlaylistDTO({ ...basePlaylist, items: { total: 5 }, tracks: { total: 999 } });

        expect(dto.trackCount).toBe(5);
    });

    it('falls back to tracks.total when items is absent', () => {
        const dto = toPlaylistDTO({ ...basePlaylist, tracks: { total: 3 } });

        expect(dto.trackCount).toBe(3);
    });

    it('defaults trackCount to 0 when neither items nor tracks is present', () => {
        const dto = toPlaylistDTO({ ...basePlaylist });

        expect(dto.trackCount).toBe(0);
    });

    it('maps the remaining fields and defaults description/imageUrl', () => {
        const dto = toPlaylistDTO({
            id: 'other-id',
            name: 'Other',
            public: true,
            images: [],
            external_urls: { spotify: 'https://open.spotify.com/playlist/other-id' }
        });

        expect(dto).toEqual({
            id: 'other-id',
            name: 'Other',
            description: '',
            trackCount: 0,
            public: true,
            imageUrl: null,
            url: 'https://open.spotify.com/playlist/other-id'
        });
    });
});
