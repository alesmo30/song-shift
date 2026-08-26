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

const NAME_SPLIT_PATTERN = /,|&|\band\b|\by\b|\bfeat\.?\b|\bfeaturing\b|\bft\.?\b|\bwith\b/gi;

const KEYWORD_PENALTY_PATTERN = /\b(live|karaoke|tribute|cover|instrumental|sped up|slowed|8d|remix)\b/i;

const WEIGHTS_WITH_DURATION = { title: 0.45, artist: 0.30, duration: 0.20, popularity: 0.05 };
const WEIGHTS_WITHOUT_DURATION = { title: 0.56, artist: 0.38, popularity: 0.06 };

const KEYWORD_PENALTY = 0.15;
const COMPILATION_PENALTY = 0.10;
const COMPILATION_PROXIMITY = 0.05;

const MATCH_THRESHOLD = 85;
const AMBIGUOUS_THRESHOLD = 60;
const NEAR_TIE_GAP = 0.04;
const LOW_SOURCE_CONFIDENCE = 70;

const DURATION_EXACT_MS = 2000;
const DURATION_ZERO_MS = 15000;

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

const toBigrams = (value) => {
    const bigrams = new Set();
    for (let i = 0; i < value.length - 1; i += 1) {
        bigrams.add(value.slice(i, i + 2));
    }
    return bigrams;
};

const diceSimilarity = (a, b) => {
    if (!a || !b) return 0;
    if (a === b) return 1;

    const bigramsA = toBigrams(a);
    const bigramsB = toBigrams(b);
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

    let intersection = 0;
    bigramsA.forEach((bigram) => {
        if (bigramsB.has(bigram)) intersection += 1;
    });

    return (2 * intersection) / (bigramsA.size + bigramsB.size);
};

const crossArtistSimilarity = (sourceArtists, candidateArtists) => {
    if (!sourceArtists.length || !candidateArtists.length) return 0;

    let max = 0;
    sourceArtists.forEach((source) => {
        candidateArtists.forEach((candidate) => {
            max = Math.max(max, diceSimilarity(source, candidate));
        });
    });

    return max;
};

const durationScore = (sourceMs, candidateMs) => {
    const diff = Math.abs(sourceMs - candidateMs);
    if (diff <= DURATION_EXACT_MS) return 1;
    if (diff >= DURATION_ZERO_MS) return 0;
    return 1 - (diff - DURATION_EXACT_MS) / (DURATION_ZERO_MS - DURATION_EXACT_MS);
};

const buildSourceArtists = (source) => {
    const { featured } = normalizeTitle(source.title);
    const fromArtistField = splitFeaturedArtists(source.artist);
    return [...new Set([...fromArtistField, ...featured])];
};

const scoreCandidate = (source, candidate) => {
    const reasons = [];

    const sourceTitle = normalizeTitle(source.title).title;
    const candidateTitle = normalizeTitle(candidate.title).title;
    const sourceArtists = buildSourceArtists(source);
    const candidateArtists = (candidate.artists || []).map(normalizeArtist).filter(Boolean);

    const exactTitle = Boolean(sourceTitle) && sourceTitle === candidateTitle;
    const titleScore = exactTitle ? 1 : diceSimilarity(sourceTitle, candidateTitle);
    if (exactTitle) reasons.push('exact-title');

    const crossArtistScore = crossArtistSimilarity(sourceArtists, candidateArtists);
    const primaryExact = Boolean(sourceArtists[0]) && sourceArtists[0] === candidateArtists[0];
    const artistScore = primaryExact ? Math.max(crossArtistScore, 0.9) : crossArtistScore;
    if (primaryExact) reasons.push('exact-artist');

    const sourceDurationMs = parseDurationToMs(source.duration);
    const candidateDurationMs = candidate.durationMs;
    const hasBothDurations = sourceDurationMs != null && candidateDurationMs != null;

    let weighted;
    if (hasBothDurations) {
        const durationComponent = durationScore(sourceDurationMs, candidateDurationMs);
        if (Math.abs(sourceDurationMs - candidateDurationMs) <= DURATION_EXACT_MS) reasons.push('duration-2s');

        weighted = WEIGHTS_WITH_DURATION.title * titleScore
            + WEIGHTS_WITH_DURATION.artist * artistScore
            + WEIGHTS_WITH_DURATION.duration * durationComponent
            + WEIGHTS_WITH_DURATION.popularity * ((candidate.popularity ?? 0) / 100);
    } else {
        reasons.push('no-source-duration');

        weighted = WEIGHTS_WITHOUT_DURATION.title * titleScore
            + WEIGHTS_WITHOUT_DURATION.artist * artistScore
            + WEIGHTS_WITHOUT_DURATION.popularity * ((candidate.popularity ?? 0) / 100);
    }

    let penalty = 0;
    if (KEYWORD_PENALTY_PATTERN.test(candidateTitle) && !KEYWORD_PENALTY_PATTERN.test(sourceTitle)) {
        penalty += KEYWORD_PENALTY;
        reasons.push('keyword-penalty');
    }

    const score = Math.max(0, Math.min(1, weighted - penalty));

    return { score, reasons };
};

const applyCompilationPenalty = (scored) => {
    scored.forEach((entry, index) => {
        if (!entry.candidate.isCompilation) return;

        const hasCloseNonCompilation = scored.some((other, otherIndex) => (
            otherIndex !== index
            && !other.candidate.isCompilation
            && Math.abs(other.score - entry.score) < COMPILATION_PROXIMITY
        ));

        if (hasCloseNonCompilation) {
            entry.score = Math.max(0, entry.score - COMPILATION_PENALTY);
            entry.reasons = [...entry.reasons, 'compilation-penalty'];
        }
    });
};

const pickBest = (source, candidates) => {
    if (!candidates || !candidates.length) {
        return { status: 'not_found', best: null, candidates: [] };
    }

    const scored = candidates.map((candidate) => {
        const { score, reasons } = scoreCandidate(source, candidate);
        return { candidate, score, reasons };
    });

    applyCompilationPenalty(scored);
    scored.sort((a, b) => b.score - a.score);

    const [first, second] = scored;
    const topScore100 = first.score * 100;

    let status;
    if (topScore100 >= MATCH_THRESHOLD) status = 'matched';
    else if (topScore100 >= AMBIGUOUS_THRESHOLD) status = 'ambiguous';
    else status = 'not_found';

    const isNearTie = Boolean(second) && Math.abs(first.score - second.score) < NEAR_TIE_GAP;
    const isLowSourceConfidence = typeof source.confidence === 'number' && source.confidence < LOW_SOURCE_CONFIDENCE;

    if (isNearTie) first.reasons = [...first.reasons, 'near-tie'];
    if (isLowSourceConfidence) first.reasons = [...first.reasons, 'low-source-confidence'];
    if (isNearTie || isLowSourceConfidence) status = 'ambiguous';

    const candidatesOut = scored.slice(0, 5).map((entry) => {
        const { isCompilation, ...trackMatch } = entry.candidate;
        return {
            ...trackMatch,
            confidence: Math.round(entry.score * 100),
            reasons: entry.reasons
        };
    });

    const best = status === 'not_found' ? null : candidatesOut[0];

    return { status, best, candidates: candidatesOut };
};

module.exports = {
    normalizeTitle,
    normalizeArtist,
    splitFeaturedArtists,
    parseDurationToMs,
    scoreCandidate,
    pickBest
};
