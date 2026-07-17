
const mongoose = require('mongoose');
const { TOKEN_TYPE } = require('../token/const/token.constants');
const TokenService = require('../token/token.service');
const prismaClient = require('../../lib/prisma');
const logger = require('../../utils/logger');
const bcrypt = require('bcryptjs');
const { AuthenticationError } = require('../../utils/errors');
const tokenSchema = require('../../mongo/token-schema');
const prisma = require('../../lib/prisma');
const { isNil } = require('lodash');

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
        const tokenSaved = await createTokens(user.id, user.email, user.role);

        return res.status(200).send(tokenSaved);
    } catch (error) {
        logger.error(`[Login] Error: ${error.message}`);
        next(error);
    }
}

const renewTokens = async (req, res) => {
    // Validate refresh token is still valid in DB 
    const { refreshToken, userId } = req.body;

    try {
        // Should be only one active always +1 (not good)
        const lastValidTokenByUser = await tokenSchema.findOne({
            user: userId,
            active: true,
        });

        if (refreshToken !== lastValidTokenByUser?.refreshToken) {
            // This should induce the user to relogin
            throw new AuthenticationError('Invalid refresh token');
        }

        // Verify RT is not expired - It throws an error if it is expired
        const isValidToken = TokenService.isRefreshTokenStillActive(refreshToken);

        if (isValidToken) {
            return res.status(200).send({
                message: 'Token is still valid'
            });
        }

        // Get user info
        const user = await prisma.user.findFirst({
            where: {
                id: userId
            }
        });

        if (isNil(user)) {
            logger.error(`[RenewTokens] Error: User not found`);
            throw new AuthenticationError('User not found');
        }

        // let's deactivate the old token and soft deleted and create a new one,
        // wrapped in a transaction so a failure creating the new token rolls back the deactivation.
        const session = await mongoose.startSession();
        let tokenSaved;

        try {
            await session.withTransaction(async () => {
                await tokenSchema.updateOne({
                    _id: lastValidTokenByUser._id
                }, {
                    $set: {
                        active: false
                    }
                }, { session });

                // Now let's create a new one
                const { id, email, role } = user;
                tokenSaved = await createTokens(id, email, role, session);
            });
        } finally {
            await session.endSession();
        }

        logger.info(`[RenewTokens] Tokens renewed for user: ${userId}`);

        // Return new token pair
        return res.status(200).send({
            accessToken: tokenSaved.accessToken,
            refreshToken: tokenSaved.refreshToken,
        });


    } catch (error) {
        throw new AuthenticationError(error?.message && typeof error?.message === 'string' ? error.message : 'Something happened trying to renew the tokens. Please try again.')
    }
}


const createTokens = async (userId, email, role, session) => {
    const payload = {
        id: userId,
        email,
        role,
    }
    const tokenService = new TokenService(TOKEN_TYPE.BOTH_TOKENS, payload);
    const tokens = tokenService.generateToken();

    // Calculate token expiration dates
    const now = new Date();
    const accessTokenExpiresAt = new Date(now);
    accessTokenExpiresAt.setDate(now.getDate() + 1); // 1 day from now

    const refreshTokenExpiresAt = new Date(now);
    refreshTokenExpiresAt.setDate(now.getDate() + 7); // 7 days from now

    // Save to mongo
    const tokenModel = new tokenSchema({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: userId,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
    });

    const tokenSaved = await tokenModel.save({ session });
    return tokenSaved;
}

module.exports = {
    login,
    renewTokens
}
