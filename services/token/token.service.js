


require('dotenv/config');

const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const { AuthenticationError } = require('../../utils/errors');
const { TOKEN_TYPE } = require('./const/token.constants');

class TokenService {

    refreshExpiresTime = dayjs().add(7, 'day').format();
    accessExpiresTime = dayjs().add(1, 'day').format();

    constructor(
        tokenType = TOKEN_TYPE.ACCESS_TOKEN,
        payload = {}
    ) {
        this.tokenType = tokenType;
        this.payload = payload;

        this.accessTokenSecret = config.JWT_ACCESS_TOKEN_SECRET;
        this.refreshTokenSecret = config.JWT_REFRESH_TOKEN_SECRET;
    }

    generateToken() {
        switch (this.tokenType) {
            case TOKEN_TYPE.ACCESS_TOKEN:
                return this.generateAccessToken();
            case TOKEN_TYPE.REFRESH_TOKEN:
                return this.generateRefreshToken();
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