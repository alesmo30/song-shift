const crypto = require('crypto');
const { isNumber, isString, trim, uniqBy } = require('lodash');

const toTrimmedString = (value) => (isString(value) ? trim(value) : '');

const buildSongId = (title, artist) => {
    const key = `${title}|${artist}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
};

const normalizeSong = (song) => {
    const title = toTrimmedString(song.title);
    const artist = toTrimmedString(song.artist);
    const duration = toTrimmedString(song.duration) || null;
    const confidence = isNumber(song.confidence) ? song.confidence : 0;

    return {
        id: buildSongId(title, artist),
        title,
        artist,
        duration,
        confidence
    };
};

const dedupeSongs = (songs) => uniqBy(songs, 'id');

module.exports = {
    normalizeSong,
    dedupeSongs,
    buildSongId
};
