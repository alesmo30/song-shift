const { PLAYLIST_STATUS } = require('./const/playlist.constants');

const sendToPlaylist = (req, res) => res.status(202).send({
    playlistId: process.env.SPOTIFY_PLAYLIST_ID,
    accepted: req.body.songs.length,
    status: PLAYLIST_STATUS.NOT_IMPLEMENTED
});

module.exports = {
    sendToPlaylist
};
