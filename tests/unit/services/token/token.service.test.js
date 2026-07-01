
const jwt = require('jsonwebtoken');
const TokenService = require('../../../../services/token/token.service');
const { TOKEN_TYPE } = require('../../../../services/token/const/token.constants');
const { AuthenticationError } = require('../../../../utils/errors');

jest.mock('jsonwebtoken');

describe('TokenService', () => {
    const mockPayload = { userId: 1, email: 'test@example.com' };
    const mockAccessTokenSecret = 'access-secret';
    const mockRefreshTokenSecret = 'refresh-secret';

    beforeEach(() => {
        process.env.JWT_ACCESS_TOKEN_SECRET = mockAccessTokenSecret;
        process.env.JWT_REFRESH_TOKEN_SECRET = mockRefreshTokenSecret;
        jest.clearAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with default values', () => {
            const service = new TokenService();
            expect(service.tokenType).toBe(TOKEN_TYPE.ACCESS_TOKEN);
            expect(service.payload).toEqual({});
            expect(service.accessTokenSecret).toBe(mockAccessTokenSecret);
            expect(service.refreshTokenSecret).toBe(mockRefreshTokenSecret);
        });

        it('should initialize with provided values', () => {
            const service = new TokenService(TOKEN_TYPE.REFRESH_TOKEN, mockPayload);
            expect(service.tokenType).toBe(TOKEN_TYPE.REFRESH_TOKEN);
            expect(service.payload).toEqual(mockPayload);
        });
    });

    describe('generateToken', () => {
        it('should generate an access token when tokenType is ACCESS_TOKEN', () => {
            const service = new TokenService(TOKEN_TYPE.ACCESS_TOKEN, mockPayload);
            jwt.sign.mockReturnValue('mock-access-token');

            const result = service.generateToken();

            expect(result).toBe('mock-access-token');
            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockAccessTokenSecret,
                { expiresIn: service.accessExpiresTime }
            );
        });

        it('should generate a refresh token when tokenType is REFRESH_TOKEN', () => {
            const service = new TokenService(TOKEN_TYPE.REFRESH_TOKEN, mockPayload);
            jwt.sign.mockReturnValue('mock-refresh-token');

            const result = service.generateToken();

            expect(result).toBe('mock-refresh-token');
            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockRefreshTokenSecret,
                { expiresIn: service.refreshExpiresTime }
            );
        });

        it('should generate both tokens when tokenType is BOTH_TOKENS', () => {
            const service = new TokenService(TOKEN_TYPE.BOTH_TOKENS, mockPayload);
            jwt.sign
                .mockReturnValueOnce('mock-access-token')
                .mockReturnValueOnce('mock-refresh-token');

            const result = service.generateToken();

            expect(result).toEqual({
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token'
            });
            expect(jwt.sign).toHaveBeenCalledTimes(2);
            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockAccessTokenSecret,
                { expiresIn: service.accessExpiresTime }
            );
            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockRefreshTokenSecret,
                { expiresIn: service.refreshExpiresTime }
            );
        });

        it('should throw AuthenticationError for invalid token type', () => {
            const service = new TokenService('INVALID_TYPE', mockPayload);

            expect(() => service.generateToken()).toThrow(AuthenticationError);
            expect(() => service.generateToken()).toThrow('Invalid token type');
        });
    });

    describe('generateAccessToken', () => {
        it('should call jwt.sign with correct parameters', () => {
            const service = new TokenService(TOKEN_TYPE.ACCESS_TOKEN, mockPayload);
            jwt.sign.mockReturnValue('mock-access-token');

            const result = service.generateAccessToken();

            expect(result).toBe('mock-access-token');
            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockAccessTokenSecret,
                { expiresIn: service.accessExpiresTime }
            );
        });
    });

    describe('generateRefreshToken', () => {
        it('should call jwt.sign with correct parameters', () => {
            const service = new TokenService(TOKEN_TYPE.REFRESH_TOKEN, mockPayload);
            jwt.sign.mockReturnValue('mock-refresh-token');

            const result = service.generateRefreshToken();

            expect(result).toBe('mock-refresh-token');
            expect(jwt.sign).toHaveBeenCalledWith(
                mockPayload,
                mockRefreshTokenSecret,
                { expiresIn: service.refreshExpiresTime }
            );
        });
    });
});
