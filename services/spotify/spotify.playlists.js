const prisma = require('../../lib/prisma');
const { AppError } = require('../../utils/errors');
const { spotifyFetch } = require('./spotify.client');
const { toPlaylistDTO } = require('./playlist.mapper');

const requireAccount = async (userId) => {
    const account = await prisma.spotifyAccount.findUnique({ where: { userId } });

    if (!account) {
        throw new AppError('Spotify account not connected', 409, { code: 'SPOTIFY_NOT_CONNECTED' });
    }

    return account;
};

const listPlaylists = async (req, res, next) => {
    try {
        const { limit = 20, offset = 0 } = req.query;

        const account = await requireAccount(req.user.id);

        const data = await spotifyFetch(req.user.id, '/v1/me/playlists', { query: { limit, offset } });

        const items = data.items
            .filter((playlist) => playlist.owner.id === account.spotifyUserId)
            .map(toPlaylistDTO);

        return res.status(200).json({
            items,
            total: data.total,
            limit: data.limit,
            offset: data.offset
        });
    } catch (error) {
        next(error);
    }
};

const createPlaylist = async (req, res, next) => {
    try {
        const { name } = req.body;

        await requireAccount(req.user.id);

        const playlist = await spotifyFetch(req.user.id, '/v1/me/playlists', {
            method: 'POST',
            body: { name, public: false }
        });

        return res.status(201).json(toPlaylistDTO(playlist));
    } catch (error) {
        next(error);
    }
};

const setDefaultPlaylist = async (req, res, next) => {
    try {
        const { playlistId } = req.body;

        await prisma.spotifyAccount.update({
            where: { userId: req.user.id },
            data: { defaultPlaylistId: playlistId }
        });

        return res.status(200).json({ defaultPlaylistId: playlistId });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    listPlaylists,
    createPlaylist,
    setDefaultPlaylist
};
