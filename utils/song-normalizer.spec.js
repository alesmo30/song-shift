const { normalizeSong, dedupeSongs, buildSongId } = require('./song-normalizer');

describe('utils/song-normalizer', () => {
    describe('buildSongId', () => {
        it('is deterministic for the same title and artist', () => {
            expect(buildSongId('Blinding Lights', 'The Weeknd')).toBe(buildSongId('Blinding Lights', 'The Weeknd'));
        });

        it('is case-insensitive', () => {
            expect(buildSongId('Blinding Lights', 'The Weeknd')).toBe(buildSongId('blinding lights', 'the weeknd'));
        });

        it('ignores accents', () => {
            expect(buildSongId('Cancion', 'Artista')).toBe(buildSongId('Canción', 'Artísta'));
        });

        it('returns a 16 character hex string', () => {
            const id = buildSongId('Title', 'Artist');
            expect(id).toMatch(/^[0-9a-f]{16}$/);
        });

        it('produces different ids for different titles or artists', () => {
            expect(buildSongId('Song A', 'Artist')).not.toBe(buildSongId('Song B', 'Artist'));
            expect(buildSongId('Song', 'Artist A')).not.toBe(buildSongId('Song', 'Artist B'));
        });
    });

    describe('normalizeSong', () => {
        it('trims title and artist and attaches a deterministic id', () => {
            const result = normalizeSong({ title: '  Song  ', artist: '  Artist  ', duration: '3:24', confidence: 90 });

            expect(result).toEqual({
                id: buildSongId('Song', 'Artist'),
                title: 'Song',
                artist: 'Artist',
                duration: '3:24',
                confidence: 90
            });
        });

        it('normalizes an empty duration string to null', () => {
            const result = normalizeSong({ title: 'Song', artist: 'Artist', duration: '', confidence: 50 });
            expect(result.duration).toBeNull();
        });

        it('keeps a null duration as null', () => {
            const result = normalizeSong({ title: 'Song', artist: 'Artist', duration: null, confidence: 50 });
            expect(result.duration).toBeNull();
        });

        it('defaults confidence to 0 when missing or not a number', () => {
            const result = normalizeSong({ title: 'Song', artist: 'Artist', duration: null });
            expect(result.confidence).toBe(0);
        });

        it('defaults title and artist to empty strings when missing', () => {
            const result = normalizeSong({ duration: null, confidence: 10 });
            expect(result.title).toBe('');
            expect(result.artist).toBe('');
        });
    });

    describe('dedupeSongs', () => {
        it('removes songs with a repeated id, keeping the first occurrence', () => {
            const first = normalizeSong({ title: 'Song', artist: 'Artist', duration: '3:00', confidence: 80 });
            const duplicate = normalizeSong({ title: 'Song', artist: 'Artist', duration: '3:05', confidence: 40 });

            const result = dedupeSongs([first, duplicate]);

            expect(result).toEqual([first]);
        });

        it('keeps songs with different ids', () => {
            const songA = normalizeSong({ title: 'Song A', artist: 'Artist', duration: null, confidence: 80 });
            const songB = normalizeSong({ title: 'Song B', artist: 'Artist', duration: null, confidence: 80 });

            expect(dedupeSongs([songA, songB])).toEqual([songA, songB]);
        });

        it('returns an empty array for an empty input', () => {
            expect(dedupeSongs([])).toEqual([]);
        });
    });
});
