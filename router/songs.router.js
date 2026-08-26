const express = require('express');
const { extractSongs } = require('../services/songs/song-extraction');
const auth = require('../middlewares/auth');
const uploadMiddleware = require('../middlewares/upload.middleware');
const router = express.Router();

router.post('/songs/extract', auth, uploadMiddleware, extractSongs);

module.exports = { songsRouter: router };
