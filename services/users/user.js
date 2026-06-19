const bcrypt = require('bcryptjs');
const { isNil } = require('lodash');

const prisma = require('../../lib/prisma');
const { AppError } = require('../../utils/errors');
const { handleServiceError } = require('../../helpers/user.service.helper');
const logger = require('../../utils/logger');

const saveUser = async (req, res) => {
    const { name, lastName, email, password: temporalPassword, role } = req.body;

    try {

        const isUserCreated = await prisma.user.findFirst({
            where: { email }
        });

        if (!isNil(isUserCreated)) {
            logger.error(`[saveUser] Error: User already exists: ${email}`);
            throw new AppError('User already exists', 400);
        }

        const hashedPassword = await bcrypt.hash(temporalPassword, 10);

        const user = await prisma.user.create({
            data: { name, lastName, email, password: hashedPassword, role }
        });

        logger.info(`[saveUser] User created: ${user.id}`);

        return res.status(201).send(user);
    } catch (error) {
        logger.error(`[saveUser] Error: ${error.message}`);

        return handleServiceError(res, error, 'Error saving user');
    }
}

const getUser = async (req, res) => {
    const id = req.params.id;

    if (isNil(id)) {
        logger.error(`[getUser] Error: User id is required: ${id}`);
        throw new AppError('User id is required', 400);
    }

    try {

        const user = await prisma.user.findUnique({
            select: {
                id: true,
                name: true,
                lastName: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true
            },
            where: { id }
        });

        if (isNil(user)) {
            logger.error(`[getUser] Error: User not found: ${id}`);
            throw new AppError('User not found', 404);
        }

        logger.info(`[getUser] User found: ${user.id}`);
        return res.status(200).send(user);

    } catch (error) {
        console.error(`[getUser] Error: ${error.message}`);

        return handleServiceError(res, error, 'Error getting user');
    }

}

module.exports = {
    saveUser,
    getUser
}
