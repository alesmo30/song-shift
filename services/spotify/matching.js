const { isString } = require('lodash');

const CURLY_QUOTES_MAP = {
    '‘': "'",
    '’': "'",
    '“': '"',
    '”': '"'
};

const TITLE_SUFFIX_PATTERNS = [
    /\s*-\s*remastered(\s*\d{4})?\s*$/i,
    /\s*\(\s*deluxe(\s+edition)?\s*\)\s*/gi,
    /\s*\(\s*bonus track\s*\)\s*/gi,
    /\s*-\s*radio edit\s*$/i,
    /\s*\(\s*original motion picture soundtrack\s*\)\s*/gi
];

const FEATURED_PATTERN = /\(?\s*\b(?:feat|featuring|ft|with)\.?\s*([^()]+)\s*\)?(?=\s|$)/i;

const NAME_SPLIT_PATTERN = /,|&|\band\b|\by\b/gi;

const stripDiacritics = (value) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

const straightenQuotes = (value) => value.replace(/[‘’“”]/g, (char) => CURLY_QUOTES_MAP[char]);

const removePunctuation = (value) => value.replace(/'/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ');

const collapseSpaces = (value) => value.replace(/\s+/g, ' ').trim();

const normalizeArtist = (artist) => {
    if (!isString(artist) || !artist.trim()) return '';

    let value = stripDiacritics(artist).toLowerCase();
    value = straightenQuotes(value);
    value = removePunctuation(value);
    value = collapseSpaces(value);

    return value;
};

const splitFeaturedArtists = (artistString) => {
    if (!isString(artistString) || !artistString.trim()) return [];

    return artistString
        .split(NAME_SPLIT_PATTERN)
        .map((name) => normalizeArtist(name))
        .filter(Boolean);
};

const normalizeTitle = (title) => {
    if (!isString(title) || !title.trim()) return { title: '', featured: [] };

    let value = stripDiacritics(title).toLowerCase();
    value = straightenQuotes(value);

    const featuredMatch = value.match(FEATURED_PATTERN);
    const featured = featuredMatch ? splitFeaturedArtists(featuredMatch[1]) : [];
    if (featuredMatch) {
        value = `${value.slice(0, featuredMatch.index)}${value.slice(featuredMatch.index + featuredMatch[0].length)}`;
    }

    TITLE_SUFFIX_PATTERNS.forEach((pattern) => {
        value = value.replace(pattern, ' ');
    });

    value = removePunctuation(value);
    value = collapseSpaces(value);

    return { title: value, featured };
};

const parseDurationToMs = (duration) => {
    if (!isString(duration) || !duration.trim()) return null;

    const parts = duration.trim().split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;

    const numbers = parts.map(Number);
    const seconds = numbers.length === 3
        ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
        : numbers[0] * 60 + numbers[1];

    return seconds * 1000;
};

module.exports = {
    normalizeTitle,
    normalizeArtist,
    splitFeaturedArtists,
    parseDurationToMs
};
