const express = require('express');
const auth = require('../middlewares/auth');
const {
    authUrlSchemaValidation,
    createPlaylistSchemaValidation,
    defaultPlaylistSchemaValidation,
    matchSongsSchemaValidation,
    addTracksSchemaValidation
} = require('../middlewares/spotify-schema.validation');
const { startOAuth, oauthCallback, getStatus, disconnect } = require('../services/spotify/spotify.auth');
const { listPlaylists, createPlaylist, setDefaultPlaylist } = require('../services/spotify/spotify.playlists');
const { matchTracks, searchTracks } = require('../services/spotify/spotify.match');
const { addTracks } = require('../services/spotify/spotify.tracks');
const router = express.Router();

router.post('/spotify/auth-url', auth, authUrlSchemaValidation, startOAuth);
router.get('/spotify/callback', oauthCallback);
router.get('/spotify/status', auth, getStatus);
router.delete('/spotify/connection', auth, disconnect);
router.get('/spotify/playlists', auth, listPlaylists);
router.post('/spotify/playlists', auth, createPlaylistSchemaValidation, createPlaylist);
router.put('/spotify/default-playlist', auth, defaultPlaylistSchemaValidation, setDefaultPlaylist);
router.post('/spotify/match', auth, matchSongsSchemaValidation, matchTracks);
router.get('/spotify/search', auth, searchTracks);
router.post('/spotify/playlists/:playlistId/items', auth, addTracksSchemaValidation, addTracks);

module.exports = { spotifyRouter: router };
