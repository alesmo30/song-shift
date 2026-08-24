const { extractSongsFromImage } = require('../groq/groq.client');
const { buildSongId } = require('../../utils/song-normalizer');
const { extractSongs } = require('./song-extraction');

jest.mock('../groq/groq.client', () => ({
    extractSongsFromImage: jest.fn()
}));

const buildFile = (name) => ({ buffer: Buffer.from(name), mimetype: 'image/png' });

const buildRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
};

describe('services/songs/song-extraction', () => {
    describe('extractSongs', () => {
        it('merges songs found across multiple screenshots and dedupes repeats', async () => {
            extractSongsFromImage
                .mockResolvedValueOnce([{ title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 90 }])
                .mockResolvedValueOnce([
                    { title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 85 },
                    { title: 'Song B', artist: 'Artist', duration: null, confidence: 70 }
                ]);

            const req = { files: [buildFile('shot1'), buildFile('shot2')] };
            const res = buildRes();
            const next = jest.fn();

            await extractSongs(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.send.mock.calls[0][0];
            expect(body.processed).toBe(2);
            expect(body.failed).toBe(0);
            expect(body.songs).toHaveLength(2);
            expect(body.songs.map((s) => s.id)).toEqual([
                buildSongId('Song A', 'Artist'),
                buildSongId('Song B', 'Artist')
            ]);
            expect(next).not.toHaveBeenCalled();
        });

        it('does not fail the whole request when one screenshot fails', async () => {
            extractSongsFromImage
                .mockResolvedValueOnce([{ title: 'Song A', artist: 'Artist', duration: '3:00', confidence: 90 }])
                .mockRejectedValueOnce(new Error('Groq extraction failed'));

            const req = { files: [buildFile('shot1'), buildFile('shot2')] };
            const res = buildRes();
            const next = jest.fn();

            await extractSongs(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.send.mock.calls[0][0];
            expect(body.processed).toBe(1);
            expect(body.failed).toBe(1);
            expect(body.songs).toHaveLength(1);
            expect(next).not.toHaveBeenCalled();
        });

        it('returns an empty songs list with failed equal to the file count when every screenshot fails', async () => {
            extractSongsFromImage
                .mockRejectedValueOnce(new Error('Groq extraction failed'))
                .mockRejectedValueOnce(new Error('Groq extraction failed'));

            const req = { files: [buildFile('shot1'), buildFile('shot2')] };
            const res = buildRes();
            const next = jest.fn();

            await extractSongs(req, res, next);

            expect(res.status).toHaveBeenCalledWith(200);
            const body = res.send.mock.calls[0][0];
            expect(body.songs).toEqual([]);
            expect(body.processed).toBe(0);
            expect(body.failed).toBe(2);
        });

        it('forwards unexpected errors to next', async () => {
            const req = { files: null };
            const res = buildRes();
            const next = jest.fn();

            await extractSongs(req, res, next);

            expect(next).toHaveBeenCalledWith(expect.any(Error));
            expect(res.status).not.toHaveBeenCalled();
        });
    });
});
