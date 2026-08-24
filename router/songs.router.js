const express = require('express');
const { extractSongs } = require('../services/songs/song-extraction');
const { sendToPlaylist } = require('../services/playlist/playlist');
const auth = require('../middlewares/auth');
const uploadMiddleware = require('../middlewares/upload.middleware');
const { songSelectionValidation } = require('../middlewares/song-selection.validation');
const router = express.Router();

router.post('/songs/extract', auth, uploadMiddleware, extractSongs);
router.post('/songs/playlist', auth, songSelectionValidation, sendToPlaylist);

module.exports = { songsRouter: router };
