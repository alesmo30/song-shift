const {
    authUrlSchemaValidation,
    createPlaylistSchemaValidation,
    defaultPlaylistSchemaValidation
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
});
