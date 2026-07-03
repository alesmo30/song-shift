module.exports = {
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/jest.setup.js'],
    clearMocks: true,
    collectCoverageFrom: [
        'middlewares/**/*.js',
        'router/**/*.js',
        'services/**/*.js',
        'utils/**/*.js'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/generated/',
        'lib/prisma.js'
    ],
    coverageThreshold: {
        global: {
            branches: 90,
            functions: 90,
            lines: 90,
            statements: 90
        }
    }
};
