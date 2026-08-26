const {
    authUrlSchemaValidation,
    createPlaylistSchemaValidation,
    defaultPlaylistSchemaValidation,
    matchSongsSchemaValidation,
    addTracksSchemaValidation
} = require('./spotify-schema.validation');
const { ValidationError } = require('../utils/errors');

describe('middlewares/spotify-schema.validation', () => {
    const buildReq = (body) => ({ body });

    it('calls next and keeps a valid redirectPath', () => {
        const req = buildReq({ redirectPath: '/dashboard' });
        const next = jest.fn();

        authUrlSchemaValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith();
        expect(req.body).toEqual({ redirectPath: '/dashboard' });
    });

    it('defaults redirectPath to "/" when the body is empty', () => {
        const req = buildReq({});
        const next = jest.fn();

        authUrlSchemaValidation(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.body).toEqual({ redirectPath: '/' });
    });

    it('rejects a double-slash redirectPath (open-redirect guard)', () => {
        const req = buildReq({ redirectPath: '//evil.com' });

        expect(() => authUrlSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    it('rejects an absolute URL as redirectPath', () => {
        const req = buildReq({ redirectPath: 'http://evil.com' });

        try {
            authUrlSchemaValidation(req, {}, jest.fn());
            throw new Error('expected authUrlSchemaValidation to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            expect(error.details).toHaveProperty('redirectPath');
        }
    });

    it('rejects a redirectPath that does not start with a slash', () => {
        const req = buildReq({ redirectPath: 'dashboard' });

        expect(() => authUrlSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
    });

    describe('createPlaylistSchemaValidation', () => {
        it('calls next and keeps a valid name', () => {
            const req = buildReq({ name: 'My Playlist' });
            const next = jest.fn();

            createPlaylistSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.body).toEqual({ name: 'My Playlist' });
        });

        it('rejects a missing name with the existing error shape', () => {
            const req = buildReq({});

            try {
                createPlaylistSchemaValidation(req, {}, jest.fn());
                throw new Error('expected createPlaylistSchemaValidation to throw');
            } catch (error) {
                expect(error).toBeInstanceOf(ValidationError);
                expect(error.details).toHaveProperty('name');
            }
        });

        it('rejects a name longer than 100 characters', () => {
            const req = buildReq({ name: 'a'.repeat(101) });

            expect(() => createPlaylistSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });
    });

    describe('defaultPlaylistSchemaValidation', () => {
        it('calls next and keeps a valid playlistId', () => {
            const req = buildReq({ playlistId: 'playlist-id' });
            const next = jest.fn();

            defaultPlaylistSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.body).toEqual({ playlistId: 'playlist-id' });
        });

        it('allows a null playlistId to clear the default', () => {
            const req = buildReq({ playlistId: null });
            const next = jest.fn();

            defaultPlaylistSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.body).toEqual({ playlistId: null });
        });

        it('rejects a missing playlistId', () => {
            const req = buildReq({});

            expect(() => defaultPlaylistSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });
    });

    describe('matchSongsSchemaValidation', () => {
        const song = (overrides = {}) => ({ id: 'd1', title: 'Cruel Summer', artist: 'Taylor Swift', ...overrides });

        it('calls next with a valid single song', () => {
            const req = buildReq({ songs: [song({ duration: '2:58', confidence: 95 })] });
            const next = jest.fn();

            matchSongsSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.body.songs).toHaveLength(1);
        });

        it('allows a song without duration or confidence', () => {
            const req = buildReq({ songs: [song()] });
            const next = jest.fn();

            matchSongsSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
        });

        it('rejects an empty songs array', () => {
            const req = buildReq({ songs: [] });

            expect(() => matchSongsSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('rejects 51 songs', () => {
            const req = buildReq({ songs: Array.from({ length: 51 }, (_, i) => song({ id: `d${i}` })) });

            expect(() => matchSongsSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('accepts exactly 50 songs', () => {
            const req = buildReq({ songs: Array.from({ length: 50 }, (_, i) => song({ id: `d${i}` })) });
            const next = jest.fn();

            matchSongsSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
        });

        it('rejects a song missing title', () => {
            const req = buildReq({ songs: [{ id: 'd1', artist: 'Taylor Swift' }] });

            expect(() => matchSongsSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('rejects a confidence above 100', () => {
            const req = buildReq({ songs: [song({ confidence: 101 })] });

            expect(() => matchSongsSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });
    });

    describe('addTracksSchemaValidation', () => {
        const uri = 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr';

        it('calls next with a valid uris array', () => {
            const req = buildReq({ uris: [uri] });
            const next = jest.fn();

            addTracksSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
            expect(req.body.uris).toEqual([uri]);
        });

        it('rejects an empty uris array', () => {
            const req = buildReq({ uris: [] });

            expect(() => addTracksSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('rejects 101 uris', () => {
            const req = buildReq({ uris: Array.from({ length: 101 }, () => uri) });

            expect(() => addTracksSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('accepts exactly 100 uris', () => {
            const req = buildReq({ uris: Array.from({ length: 100 }, () => uri) });
            const next = jest.fn();

            addTracksSchemaValidation(req, {}, next);

            expect(next).toHaveBeenCalledTimes(1);
        });

        it('rejects an album uri', () => {
            const req = buildReq({ uris: ['spotify:album:1BxfuPKGuaTgP7aM0Bbdwr'] });

            expect(() => addTracksSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('rejects an episode uri', () => {
            const req = buildReq({ uris: ['spotify:episode:1BxfuPKGuaTgP7aM0Bbdwr'] });

            expect(() => addTracksSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });

        it('rejects a track uri with the wrong id length', () => {
            const req = buildReq({ uris: ['spotify:track:short'] });

            expect(() => addTracksSchemaValidation(req, {}, jest.fn())).toThrow(ValidationError);
        });
    });
});
