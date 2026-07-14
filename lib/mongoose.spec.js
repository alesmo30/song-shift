jest.mock('mongoose', () => ({
    connect: jest.fn(),
    connection: {
        close: jest.fn()
    }
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn()
}));

describe('lib/mongoose', () => {
    const ORIGINAL_ENV = process.env;

    // jest.resetModules() also re-runs the mock factories above, so the mongoose/
    // logger mocks must be re-required *after* resetting modules in every test,
    // otherwise assertions would run against stale mock instances.
    const loadModule = () => {
        const mongoose = require('mongoose');
        const logger = require('../utils/logger');
        const mongooseLib = require('./mongoose');
        return { mongoose, logger, ...mongooseLib };
    };

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    describe('connectToMongoDB', () => {
        it('connects using the configured password and db name, and logs success', async () => {
            process.env.MONGOOSE_PASSWORD = 'super-secret';
            process.env.MONGOOSE_DB_NAME = 'custom_db';

            const { mongoose, logger, connectToMongoDB } = loadModule();
            mongoose.connect.mockResolvedValue();

            const result = await connectToMongoDB();

            expect(mongoose.connect).toHaveBeenCalledWith(
                'mongodb+srv://alejodev97_db_user:super-secret@cluster0.ddqthal.mongodb.net/custom_db?appName=Cluster0'
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('custom_db')
            );
            expect(logger.error).not.toHaveBeenCalled();
            expect(result).toBe(mongoose);
        });

        it('defaults the db name to song_shift when MONGOOSE_DB_NAME is not set', async () => {
            process.env.MONGOOSE_PASSWORD = 'super-secret';
            delete process.env.MONGOOSE_DB_NAME;

            const { mongoose, logger, connectToMongoDB } = loadModule();
            mongoose.connect.mockResolvedValue();

            await connectToMongoDB();

            expect(mongoose.connect).toHaveBeenCalledWith(
                expect.stringContaining('/song_shift?appName=Cluster0')
            );
            expect(logger.info).toHaveBeenCalledWith(
                expect.stringContaining('song_shift')
            );
        });

        it('swallows connection errors and logs them instead of rethrowing', async () => {
            process.env.MONGOOSE_PASSWORD = 'super-secret';
            const failure = new Error('connection refused');

            const { mongoose, logger, connectToMongoDB } = loadModule();
            mongoose.connect.mockRejectedValue(failure);

            await expect(connectToMongoDB()).resolves.toBeUndefined();
            expect(logger.error).toHaveBeenCalledWith('Failed to connect to MongoDB!', failure);
            expect(logger.info).not.toHaveBeenCalled();
        });
    });

    describe('disconnectFromMongoDB', () => {
        it('closes the mongoose connection', async () => {
            const { mongoose, disconnectFromMongoDB } = loadModule();
            mongoose.connection.close.mockResolvedValue();

            await disconnectFromMongoDB();

            expect(mongoose.connection.close).toHaveBeenCalled();
        });
    });
});
