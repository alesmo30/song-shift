const express = require('express');
const auth = require('../middlewares/auth');
const { authUrlSchemaValidation } = require('../middlewares/spotify-schema.validation');
const { startOAuth, oauthCallback } = require('../services/spotify/spotify.auth');
const router = express.Router();

router.post('/spotify/auth-url', auth, authUrlSchemaValidation, startOAuth);
router.get('/spotify/callback', oauthCallback);

module.exports = { spotifyRouter: router };
