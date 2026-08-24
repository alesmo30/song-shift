const { sendToPlaylist } = require('./playlist');
const { PLAYLIST_STATUS } = require('./const/playlist.constants');

const buildRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
};

describe('services/playlist/playlist', () => {
    const originalPlaylistId = process.env.SPOTIFY_PLAYLIST_ID;

    afterEach(() => {
        process.env.SPOTIFY_PLAYLIST_ID = originalPlaylistId;
    });

    describe('sendToPlaylist', () => {
        it('responds 202 with the not-implemented stub payload', () => {
            process.env.SPOTIFY_PLAYLIST_ID = 'playlist-123';
            const req = { body: { songs: [{ id: 'a' }, { id: 'b' }] } };
            const res = buildRes();

            sendToPlaylist(req, res);

            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.send).toHaveBeenCalledWith({
                playlistId: 'playlist-123',
                accepted: 2,
                status: PLAYLIST_STATUS.NOT_IMPLEMENTED
            });
        });
    });
});
