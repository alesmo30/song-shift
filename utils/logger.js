const winston = require('winston');
const { format, createLogger, transports } = winston;
const { printf, combine, timestamp, colorize, uncolorize } = format;
const winstonFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp}: ${level}: ${stack || message}`;
});
const logger = createLogger({
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    format: combine(
        timestamp(),
        winstonFormat,
        process.env.NODE_ENV === 'development' ? colorize() : uncolorize()
    ),
    transports: [new transports.Console()],
});
module.exports = logger;
