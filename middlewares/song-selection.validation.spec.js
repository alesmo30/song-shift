const { songSelectionValidation } = require('./song-selection.validation');
const { ValidationError } = require('../utils/errors');

describe('middlewares/song-selection.validation', () => {
    const buildReq = (body) => ({ body });

    const song = (overrides = {}) => ({
        id: 'abc123',
        title: 'Song',
        artist: 'Artist',
        duration: '3:24',
        ...overrides
    });

    it('calls next and coerces req.body when the payload is valid', () => {
        const req = buildReq({ songs: [song()] });
        const next = jest.fn();

        songSelectionValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ songs: [song()] });
    });

    it('allows a null duration', () => {
        const req = buildReq({ songs: [song({ duration: null })] });
        const next = jest.fn();

        songSelectionValidation(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });

    it('accepts up to 100 songs', () => {
        const songs = Array.from({ length: 100 }, (_, i) => song({ id: `id-${i}` }));
        const req = buildReq({ songs });
        const next = jest.fn();

        songSelectionValidation(req, {}, next);

        expect(next).toHaveBeenCalledWith();
    });

    it('throws a ValidationError when songs is an empty array', () => {
        const req = buildReq({ songs: [] });

        expect(() => songSelectionValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when songs has more than 100 items', () => {
        const songs = Array.from({ length: 101 }, (_, i) => song({ id: `id-${i}` }));
        const req = buildReq({ songs });

        expect(() => songSelectionValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError when songs is missing', () => {
        const req = buildReq({});

        expect(() => songSelectionValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('throws a ValidationError with formatted details when a song is missing required fields', () => {
        const req = buildReq({ songs: [{ id: 'abc123' }] });

        try {
            songSelectionValidation(req, {}, jest.fn());
            throw new Error('expected songSelectionValidation to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.details).toEqual(expect.objectContaining({
                'songs.0.title': expect.any(String),
                'songs.0.artist': expect.any(String)
            }));
        }
    });
});
