const prisma = require('../../lib/prisma');
const { jwtStrategy } = require('./passport');

jest.mock('../../lib/prisma', () => ({
    user: {
        findUnique: jest.fn()
    }
}));

describe('utils/passport/passport', () => {
    const payload = { id: '1', email: 'user@example.com', role: 'USER' };

    it('calls done with the user when found', async () => {
        const user = { id: '1', email: 'user@example.com', role: 'USER' };
        prisma.user.findUnique.mockResolvedValue(user);
        const done = jest.fn();

        await jwtStrategy._verify(payload, done);

        expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: payload.email } });
        expect(done).toHaveBeenCalledWith(null, user);
    });

    it('calls done with false when the user is not found', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        const done = jest.fn();

        await jwtStrategy._verify(payload, done);

        expect(done).toHaveBeenCalledWith(null, false);
    });

    it('calls done with the error when the lookup fails', async () => {
        const failure = new Error('DB unavailable');
        prisma.user.findUnique.mockRejectedValue(failure);
        const done = jest.fn();

        await jwtStrategy._verify(payload, done);

        expect(done).toHaveBeenCalledWith(failure, false);
    });
});
