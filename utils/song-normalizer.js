const crypto = require('crypto');
const { isString, isNumber, trim } = require('lodash');

const normalizeSong = (song) => {
    const title = isString(song.title) ? trim(song.title) : '';
    const artist = isString(song.artist) ? trim(song.artist) : '';
    const trimmedDuration = isString(song.duration) ? trim(song.duration) : '';
    const duration = trimmedDuration !== '' ? trimmedDuration : null;
    const confidence = isNumber(song.confidence) ? song.confidence : 0;

    return {
        id: buildSongId(title, artist),
        title,
        artist,
        duration,
        confidence
    };
};

const buildSongId = (title, artist) => {
    const key = `${title}|${artist}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
};

const dedupeSongs = (songs) => {
    const seen = new Map();

    songs.forEach((song) => {
        if (!seen.has(song.id)) {
            seen.set(song.id, song);
        }
    });

    return Array.from(seen.values());
};

module.exports = {
    normalizeSong,
    dedupeSongs,
    buildSongId
};
