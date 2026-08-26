const { normalizeTitle, normalizeArtist, splitFeaturedArtists, parseDurationToMs } = require('./matching');

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
});
