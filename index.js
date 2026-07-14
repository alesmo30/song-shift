

require('dotenv/config');
const http = require('http');
const { connectToMongoDB, disconnectFromMongoDB } = require('./lib/mongoose');
const server = require('./server');

connectToMongoDB();


const app = http.createServer(server)


const logger = require('./utils/logger');

const exitHandler = (options = { exitCode: 0 }) => {
    if (app) {
        app.close(async () => {
            logger.info('Server closed');
            try {
                await disconnectFromMongoDB();
                logger.info('Database connection closed');
                process.exit(options.exitCode);
            } catch (err) {
                logger.error('Error closing database connection', err);
                process.exit(1);
            }
        });
    } else {
        process.exit(options.exitCode);
    }
};
const unExpectedErrorHandler = (error) => {
    console.error(error);
    exitHandler({ exitCode: 1 });
};

process.on('uncaughtException', unExpectedErrorHandler);
process.on('unhandledRejection', unExpectedErrorHandler);

process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Starting graceful shutdown...');
    exitHandler({ exitCode: 0 });
});

process.on('SIGINT', () => {
    logger.info('SIGINT received. Starting graceful shutdown...');
    exitHandler({ exitCode: 0 });
});

app.listen(3000, () => {
    console.log('Server is running on port 3000')
})