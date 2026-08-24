const { extractSongsFromImage } = require('../groq/gemini.client');
const { normalizeSong, dedupeSongs } = require('../../utils/song-normalizer');
const logger = require('../../utils/logger');

const extractSongs = async (req, res, next) => {
    try {
        const results = await Promise.allSettled(
            req.files.map((file) => extractSongsFromImage(file.buffer.toString('base64'), file.mimetype))
        );

        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        const failed = results.length - fulfilled.length;

        results
            .filter((result) => result.status === 'rejected')
            .forEach((result) => logger.error(`[extractSongs] Error: ${result.reason?.message}`));

        const rawSongs = fulfilled.flatMap((result) => result.value);
        const songs = dedupeSongs(rawSongs.map(normalizeSong));

        logger.info(`[extractSongs] Processed: ${fulfilled.length}, Failed: ${failed}, Songs: ${songs.length}`);

        return res.status(200).send({
            songs,
            processed: fulfilled.length,
            failed
        });
    } catch (error) {
        logger.error(`[extractSongs] Error: ${error.message}`);
        next(error);
    }
};

module.exports = {
    extractSongs
};
