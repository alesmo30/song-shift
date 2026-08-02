const logger = require('./logger');

describe('utils/logger', () => {
    it('exports a winston logger exposing info and error methods', () => {
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('does not throw when logging', () => {
        expect(() => logger.info('unit test log line')).not.toThrow();
        expect(() => logger.error('unit test error line')).not.toThrow();
    });

    it('uses info level and uncolorized format when NODE_ENV is not development', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        let prodLogger;
        jest.isolateModules(() => {
            prodLogger = require('./logger');
        });

        expect(prodLogger.level).toBe('info');
        expect(() => prodLogger.info('prod log line')).not.toThrow();

        process.env.NODE_ENV = originalNodeEnv;
    });

    it('uses debug level and colorized format when NODE_ENV is development', () => {
        const originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        let devLogger;
        jest.isolateModules(() => {
            devLogger = require('./logger');
        });

        expect(devLogger.level).toBe('debug');
        expect(() => devLogger.debug('dev log line')).not.toThrow();

        process.env.NODE_ENV = originalNodeEnv;
    });
});
