const bcrypt = require('bcryptjs');
const { isNil } = require('lodash');

const prisma = require('../../lib/prisma');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const saveUser = async (req, res, next) => {
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
            data: { name, lastName, email, password: hashedPassword, role },
            select: {
                id: true,
                name: true,
                lastName: true,
                email: true,
                role: true,
                createdAt: true,
                updatedAt: true
            }
        });

        logger.info(`[saveUser] User created: ${user.id}`);

        return res.status(201).send(user);
    } catch (error) {
        logger.error(`[saveUser] Error: ${error.message}`);
        next(error);
    }
}

const getUser = async (req, res, next) => {
    const id = req.params.id;

    if (isNil(id)) {
        logger.error(`[getUser] Error: User id is required: ${id}`);
        return next(new AppError('User id is required', 400));
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
        logger.error(`[getUser] Error: ${error.message}`);
        next(error);
    }

}

module.exports = {
    saveUser,
    getUser
}
