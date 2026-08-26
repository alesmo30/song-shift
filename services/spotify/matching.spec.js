const { normalizeTitle, normalizeArtist, splitFeaturedArtists, parseDurationToMs, scoreCandidate, pickBest } = require('./matching');

const candidate = (overrides = {}) => ({
    uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr',
    id: '1BxfuPKGuaTgP7aM0Bbdwr',
    title: 'Cruel Summer',
    artists: ['Taylor Swift'],
    album: 'Lover',
    durationMs: 178426,
    isrc: 'USUG11901473',
    explicit: false,
    popularity: 94,
    imageUrl: 'https://example.com/cover.jpg',
    previewUrl: null,
    isCompilation: false,
    ...overrides
});

describe('services/spotify/matching', () => {
    describe('normalizeTitle', () => {
        it('lowercases and strips accents', () => {
            expect(normalizeTitle('Canción').title).toBe('cancion');
        });

        it('straightens typographic quotes', () => {
            expect(normalizeTitle('Don’t Stop').title).toBe('dont stop');
        });

        it('removes a "- Remastered <year>" suffix', () => {
            expect(normalizeTitle('Anti-Hero - Remastered 2011').title).toBe('anti hero');
        });

        it('removes a "(Deluxe Edition)" suffix', () => {
            expect(normalizeTitle('Lover (Deluxe Edition)').title).toBe('lover');
        });

        it('removes a "(Bonus Track)" suffix', () => {
            expect(normalizeTitle('Song (Bonus Track)').title).toBe('song');
        });

        it('removes a "- Radio Edit" suffix', () => {
            expect(normalizeTitle('Song - Radio Edit').title).toBe('song');
        });

        it('removes a "(Original Motion Picture Soundtrack)" suffix', () => {
            expect(normalizeTitle('Song (Original Motion Picture Soundtrack)').title).toBe('song');
        });

        it('extracts a "(feat. X)" into featured and removes it from the title', () => {
            const result = normalizeTitle('Cruel Summer (feat. Post Malone)');
            expect(result.title).toBe('cruel summer');
            expect(result.featured).toEqual(['post malone']);
        });

        it('extracts a trailing "feat. X" without parens', () => {
            const result = normalizeTitle('Cruel Summer feat. Post Malone');
            expect(result.title).toBe('cruel summer');
            expect(result.featured).toEqual(['post malone']);
        });

        it('extracts multiple featured artists', () => {
            const result = normalizeTitle('Song (feat. A & B)');
            expect(result.featured).toEqual(['a', 'b']);
        });

        it('returns empty title and featured for null', () => {
            expect(normalizeTitle(null)).toEqual({ title: '', featured: [] });
        });

        it('returns empty title and featured for an empty string', () => {
            expect(normalizeTitle('')).toEqual({ title: '', featured: [] });
        });

        it('collapses punctuation and repeated spaces', () => {
            expect(normalizeTitle('Hello,   World!!').title).toBe('hello world');
        });
    });

    describe('normalizeArtist', () => {
        it('lowercases and strips accents', () => {
            expect(normalizeArtist('Beyoncé')).toBe('beyonce');
        });

        it('straightens typographic quotes and removes punctuation', () => {
            expect(normalizeArtist('Guns N’ Roses')).toBe('guns n roses');
        });

        it('returns an empty string for null', () => {
            expect(normalizeArtist(null)).toBe('');
        });

        it('returns an empty string for an empty string', () => {
            expect(normalizeArtist('  ')).toBe('');
        });
    });

    describe('splitFeaturedArtists', () => {
        it('splits on commas and ampersands', () => {
            expect(splitFeaturedArtists('Taylor Swift, Ed Sheeran & Post Malone')).toEqual([
                'taylor swift',
                'ed sheeran',
                'post malone'
            ]);
        });

        it('splits on "and"', () => {
            expect(splitFeaturedArtists('A and B')).toEqual(['a', 'b']);
        });

        it('returns a single-item array for a single artist', () => {
            expect(splitFeaturedArtists('Taylor Swift')).toEqual(['taylor swift']);
        });

        it('returns an empty array for an empty string', () => {
            expect(splitFeaturedArtists('')).toEqual([]);
        });

        it('returns an empty array for null', () => {
            expect(splitFeaturedArtists(null)).toEqual([]);
        });
    });

    describe('parseDurationToMs', () => {
        it('parses "m:ss" into milliseconds', () => {
            expect(parseDurationToMs('2:58')).toBe(178000);
        });

        it('parses "h:mm:ss" into milliseconds', () => {
            expect(parseDurationToMs('1:02:03')).toBe(3723000);
        });

        it('returns null for null', () => {
            expect(parseDurationToMs(null)).toBeNull();
        });

        it('returns null for an empty string', () => {
            expect(parseDurationToMs('')).toBeNull();
        });

        it('returns null for a malformed string', () => {
            expect(parseDurationToMs('not-a-duration')).toBeNull();
        });
    });

    describe('splitFeaturedArtists — feat/ft/with separators', () => {
        it('splits on "feat."', () => {
            expect(splitFeaturedArtists('Taylor Swift feat. Post Malone')).toEqual(['taylor swift', 'post malone']);
        });

        it('splits on "with" without breaking a name that contains it as a substring', () => {
            expect(splitFeaturedArtists('Bill Withers')).toEqual(['bill withers']);
        });

        it('splits on "ft"', () => {
            expect(splitFeaturedArtists('Taylor Swift ft Post Malone')).toEqual(['taylor swift', 'post malone']);
        });
    });

    describe('scoreCandidate', () => {
        const source = { id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift', duration: '2:58', confidence: 95 };

        it('scores an exact title and artist match near 1', () => {
            const { score, reasons } = scoreCandidate(source, candidate());
            expect(score).toBeGreaterThanOrEqual(0.85);
            expect(reasons).toEqual(expect.arrayContaining(['exact-title', 'exact-artist', 'duration-2s']));
        });

        it('penalizes a candidate whose title has a live/karaoke/etc. keyword the source does not have', () => {
            const withKeyword = scoreCandidate(source, candidate({ title: 'Cruel Summer - Live' }));
            const withoutKeyword = scoreCandidate(source, candidate());
            expect(withKeyword.score).toBeLessThan(withoutKeyword.score);
            expect(withKeyword.reasons).toContain('keyword-penalty');
        });

        it('does not penalize the keyword when the source title also has it', () => {
            const liveSource = { ...source, title: 'Cruel Summer - Live' };
            const { reasons } = scoreCandidate(liveSource, candidate({ title: 'Cruel Summer - Live' }));
            expect(reasons).not.toContain('keyword-penalty');
        });

        it('renormalizes weights and adds no-source-duration when source has no duration', () => {
            const noDurationSource = { ...source, duration: null };
            const { score, reasons } = scoreCandidate(noDurationSource, candidate());
            expect(reasons).toContain('no-source-duration');
            expect(reasons).not.toContain('duration-2s');
            expect(score).toBeGreaterThan(0.8);
        });

        it('scores low for a title/artist mismatch', () => {
            const { score } = scoreCandidate(source, candidate({ title: 'Anti-Hero', artists: ['Taylor Swift'] }));
            expect(score).toBeLessThan(0.6);
        });
    });

    describe('pickBest', () => {
        const source = { id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift', duration: '2:58', confidence: 95 };

        it('returns matched with confidence >= 85 for an exact match', () => {
            const result = pickBest(source, [candidate()]);
            expect(result.status).toBe('matched');
            expect(result.best.confidence).toBeGreaterThanOrEqual(85);
        });

        it('returns not_found with best null when nothing scores 60+', () => {
            const result = pickBest(source, [candidate({ title: 'Completely Different Song', artists: ['Nobody'] })]);
            expect(result.status).toBe('not_found');
            expect(result.best).toBeNull();
            expect(result.candidates).toHaveLength(1);
        });

        it('does not return matched for a karaoke-only result', () => {
            const result = pickBest(source, [candidate({ title: 'Cruel Summer - Karaoke Version' })]);
            expect(result.status).not.toBe('matched');
        });

        it('forces ambiguous when the top two candidates are within 0.04 of each other', () => {
            const result = pickBest(source, [
                candidate({ id: 'a', title: 'Cruel Summer', popularity: 94 }),
                candidate({ id: 'b', title: 'Cruel Summer', popularity: 93 })
            ]);
            expect(result.status).toBe('ambiguous');
            expect(result.best.reasons).toContain('near-tie');
        });

        it('forces ambiguous when the source confidence is below 70, even with a high score', () => {
            const lowConfidenceSource = { ...source, confidence: 60 };
            const result = pickBest(lowConfidenceSource, [candidate()]);
            expect(result.status).toBe('ambiguous');
            expect(result.best.reasons).toContain('low-source-confidence');
        });

        it('does not penalize when there is no source duration', () => {
            const noDurationSource = { ...source, duration: null };
            const result = pickBest(noDurationSource, [candidate()]);
            expect(result.status).toBe('matched');
        });

        it('always returns candidates, even when status is matched', () => {
            const result = pickBest(source, [candidate()]);
            expect(result.candidates.length).toBeGreaterThan(0);
        });

        it('caps candidates at 5, sorted by confidence desc', () => {
            const many = Array.from({ length: 8 }, (_, i) => candidate({ id: `c${i}`, popularity: i * 10 }));
            const result = pickBest(source, many);
            expect(result.candidates).toHaveLength(5);
            const confidences = result.candidates.map((c) => c.confidence);
            expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
        });

        it('returns not_found with an empty candidates array for no candidates', () => {
            const result = pickBest(source, []);
            expect(result).toEqual({ status: 'not_found', best: null, candidates: [] });
        });

        it('applies a compilation penalty when a close non-compilation candidate exists', () => {
            const compilationHeavy = pickBest(source, [
                candidate({ id: 'comp', isCompilation: true, popularity: 50 }),
                candidate({ id: 'noncomp', isCompilation: false, popularity: 50 })
            ]);
            const noPenalty = pickBest(source, [
                candidate({ id: 'comp-alone', isCompilation: true, popularity: 50 })
            ]);
            const compEntry = compilationHeavy.candidates.find((c) => c.id === 'comp');
            expect(compEntry.reasons).toContain('compilation-penalty');
            expect(compEntry.confidence).toBeLessThan(noPenalty.candidates[0].confidence);
        });
    });
});
