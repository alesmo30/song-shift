const jwt = require('jsonwebtoken');
const TokenService = require('./token.service');
const { TOKEN_TYPE } = require('./const/token.constants');
const { AuthenticationError } = require('../../utils/errors');

jest.mock('jsonwebtoken', () => ({
    sign: jest.fn()
}));

describe('services/token/token.service', () => {
    const payload = { id: '1', email: 'user@example.com', role: 'USER' };

    beforeEach(() => {
        jwt.sign.mockImplementation((_payload, secret) => `stub-token-for-${secret}`);
    });

    it('generates only an access token for ACCESS_TOKEN type', () => {
        const tokenService = new TokenService(TOKEN_TYPE.ACCESS_TOKEN, payload);

        const result = tokenService.generateToken();

        expect(result).toBe('stub-token-for-test-access-secret');
        expect(jwt.sign).toHaveBeenCalledTimes(1);
        expect(jwt.sign).toHaveBeenCalledWith(payload, 'test-access-secret', { expiresIn: '1d' });
    });

    it('generates only a refresh token for REFRESH_TOKEN type', () => {
        const tokenService = new TokenService(TOKEN_TYPE.REFRESH_TOKEN, payload);

        const result = tokenService.generateToken();

        expect(result).toBe('stub-token-for-test-refresh-secret');
        expect(jwt.sign).toHaveBeenCalledTimes(1);
        expect(jwt.sign).toHaveBeenCalledWith(payload, 'test-refresh-secret', { expiresIn: '7d' });
    });

    it('generates both tokens with their own secrets for BOTH_TOKENS type', () => {
        const tokenService = new TokenService(TOKEN_TYPE.BOTH_TOKENS, payload);

        const result = tokenService.generateToken();

        expect(result).toEqual({
            accessToken: 'stub-token-for-test-access-secret',
            refreshToken: 'stub-token-for-test-refresh-secret'
        });
        expect(jwt.sign).toHaveBeenCalledWith(payload, 'test-access-secret', { expiresIn: '1d' });
        expect(jwt.sign).toHaveBeenCalledWith(payload, 'test-refresh-secret', { expiresIn: '7d' });
    });

    it('throws AuthenticationError for an unknown token type', () => {
        const tokenService = new TokenService('UNKNOWN_TYPE', payload);

        expect(() => tokenService.generateToken()).toThrow(AuthenticationError);
        expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('defaults to ACCESS_TOKEN type and empty payload when not provided', () => {
        const tokenService = new TokenService();

        tokenService.generateToken();

        expect(jwt.sign).toHaveBeenCalledWith({}, 'test-access-secret', { expiresIn: '1d' });
    });
});
