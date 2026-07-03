
const { TOKEN_TYPE } = require('../token/const/token.constants');
const TokenService = require('../token/token.service');
const prismaClient = require('../../lib/prisma');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs');
const { AuthenticationError } = require('../../utils/errors');

const login = async (req, res, next) => {

    try {
        const user = await prismaClient.user.findFirst({
            where: {
                email: req.body.email
            }
        })

        if (!user) {
            logger.error(`[Login] Error: User not found`);
            throw new AuthenticationError('Invalid email or password');
        }

        logger.info(`[Login] User found: ${user.id}`);

        // Validate credentials
        const isPasswordValid = await bcrypt.compare(req.body.password, user.password);

        if (!isPasswordValid) {
            logger.error(`[Login] Error: Invalid password`);
            throw new AuthenticationError('Invalid email or password');
        }

        logger.info(`[Login] Password valid: ${user.id}`);

        // Create access token
        const payload = {
            id: user.id,
            email: user.email,
            role: user.role,
        }
        const tokenService = new TokenService(TOKEN_TYPE.BOTH_TOKENS, payload);
        const tokens = tokenService.generateToken();

        return res.status(200).send(tokens);
    } catch (error) {
        logger.error(`[Login] Error: ${error.message}`);
        next(error);
    }
}


module.exports = {
    login
}
