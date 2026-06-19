

require('dotenv/config');
const http = require('http');
const server = require('./server');


const app = http.createServer(server)


const exitHandler = () => {
    if (server) {
        server.close(() => {
            logger.info('Server closed');
            process.exit(1);
        });
    } else {
        process.exit(1);
    }
};
const unExpectedErrorHandler = (error) => {
    console.error(error);
    exitHandler();
};

process.on('uncaughtException', unExpectedErrorHandler);
process.on('unhandledRejection', unExpectedErrorHandler);

app.listen(3000, () => {
    console.log('Server is running on port 3000')
})