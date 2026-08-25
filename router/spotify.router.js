const express = require('express');
const auth = require('../middlewares/auth');
const { authUrlSchemaValidation, createPlaylistSchemaValidation } = require('../middlewares/spotify-schema.validation');
const { startOAuth, oauthCallback, getStatus, disconnect } = require('../services/spotify/spotify.auth');
const { listPlaylists, createPlaylist } = require('../services/spotify/spotify.playlists');
const router = express.Router();

router.post('/spotify/auth-url', auth, authUrlSchemaValidation, startOAuth);
router.get('/spotify/callback', oauthCallback);
router.get('/spotify/status', auth, getStatus);
router.delete('/spotify/connection', auth, disconnect);
router.get('/spotify/playlists', auth, listPlaylists);
router.post('/spotify/playlists', auth, createPlaylistSchemaValidation, createPlaylist);

module.exports = { spotifyRouter: router };
