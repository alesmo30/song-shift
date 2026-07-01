


const jwt = require('jsonwebtoken');
const { AuthenticationError } = require('../../utils/errors');
const { TOKEN_TYPE } = require('./const/token.constants');

class TokenService {

    refreshExpiresTime = '7d';
    accessExpiresTime = '1d';

    constructor(
        tokenType = TOKEN_TYPE.ACCESS_TOKEN,
        payload = {}
    ) {
        this.tokenType = tokenType;
        this.payload = payload;

        this.accessTokenSecret = process.env.JWT_ACCESS_TOKEN_SECRET;
        this.refreshTokenSecret = process.env.JWT_REFRESH_TOKEN_SECRET;
    }

    generateToken() {
        switch (this.tokenType) {
            case TOKEN_TYPE.ACCESS_TOKEN:
                return this.generateAccessToken();
            case TOKEN_TYPE.REFRESH_TOKEN:
                return this.generateRefreshToken();
            case TOKEN_TYPE.BOTH_TOKENS: {
                const accessToken = this.generateAccessToken();
                const refreshToken = this.generateRefreshToken();
                return {
                    accessToken,
                    refreshToken
                }
            }
            default:
                throw new AuthenticationError("Invalid token type")
        }
    }

    generateAccessToken() {
        return jwt.sign(this.payload, this.accessTokenSecret, {
            expiresIn: this.accessExpiresTime
        });
    }

    generateRefreshToken() {
        return jwt.sign(this.payload, this.refreshTokenSecret, {
            expiresIn: this.refreshExpiresTime
        });
    }

}

module.exports = TokenService;