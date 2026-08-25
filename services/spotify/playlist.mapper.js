const toPlaylistDTO = (playlist) => ({
    id: playlist.id,
    name: playlist.name,
    description: playlist.description ?? '',
    trackCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
    public: playlist.public,
    imageUrl: playlist.images?.[0]?.url ?? null,
    url: playlist.external_urls.spotify
});

module.exports = {
    toPlaylistDTO
};
