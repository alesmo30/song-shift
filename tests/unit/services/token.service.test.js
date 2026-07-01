const TokenService = require('../../../services/token/token.service');
const { TOKEN_TYPE } = require('../../../services/token/const/token.constants');
const jwt = require('jsonwebtoken');
const { AuthenticationError } = require('../../../utils/errors');

jest.mock('jsonwebtoken');

describe('TokenService', () => {
    const payload = { id: '123', email: 'test@example.com' };
    const accessSecret = 'access-secret';
    const refreshSecret = 'refresh-secret';

    beforeEach(() => {
        process.env.JWT_ACCESS_TOKEN_SECRET = accessSecret;
        process.env.JWT_REFRESH_TOKEN_SECRET = refreshSecret;
        jest.clearAllMocks();
    });

    describe('generateToken', () => {
        it('should generate an access token when type is ACCESS_TOKEN', () => {
            const tokenService = new TokenService(TOKEN_TYPE.ACCESS_TOKEN, payload);
            jwt.sign.mockReturnValue('mock-access-token');

            const token = tokenService.generateToken();

            expect(token).toBe('mock-access-token');
            expect(jwt.sign).toHaveBeenCalledWith(payload, accessSecret, { expiresIn: '1d' });
        });

        it('should generate a refresh token when type is REFRESH_TOKEN', () => {
            const tokenService = new TokenService(TOKEN_TYPE.REFRESH_TOKEN, payload);
            jwt.sign.mockReturnValue('mock-refresh-token');

            const token = tokenService.generateToken();

            expect(token).toBe('mock-refresh-token');
            expect(jwt.sign).toHaveBeenCalledWith(payload, refreshSecret, { expiresIn: '7d' });
        });

        it('should generate both tokens when type is BOTH_TOKENS', () => {
            const tokenService = new TokenService(TOKEN_TYPE.BOTH_TOKENS, payload);
            jwt.sign
                .mockReturnValueOnce('mock-access-token')
                .mockReturnValueOnce('mock-refresh-token');

            const tokens = tokenService.generateToken();

            expect(tokens).toEqual({
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token'
            });
            expect(jwt.sign).toHaveBeenCalledTimes(2);
        });

        it('should throw AuthenticationError for invalid token type', () => {
            const tokenService = new TokenService('INVALID_TYPE', payload);
            expect(() => tokenService.generateToken()).toThrow(AuthenticationError);
        });
    });
});
