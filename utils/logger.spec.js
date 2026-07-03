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
});
