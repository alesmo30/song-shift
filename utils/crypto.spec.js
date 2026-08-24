const crypto = require('crypto');
const { encrypt, decrypt } = require('./crypto');

describe('utils/crypto', () => {
    const originalKey = process.env.SPOTIFY_TOKEN_ENC_KEY;

    beforeAll(() => {
        process.env.SPOTIFY_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
    });

    afterAll(() => {
        process.env.SPOTIFY_TOKEN_ENC_KEY = originalKey;
    });

    it('round-trips a plaintext string', () => {
        const plaintext = 'a-spotify-refresh-token';
        const ciphertext = encrypt(plaintext);

        expect(decrypt(ciphertext)).toBe(plaintext);
    });

    it('produces a different ciphertext each time for the same plaintext', () => {
        const plaintext = 'same-plaintext';

        expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
    });

    it('prefixes the ciphertext with the key version', () => {
        expect(encrypt('token')).toMatch(/^v1:/);
    });

    it('throws when the ciphertext has been tampered with', () => {
        const ciphertext = encrypt('token');
        const [version, iv, authTag, ct] = ciphertext.split(':');
        const tampered = [version, iv, authTag, Buffer.from('garbage').toString('base64') + ct].join(':');

        expect(() => decrypt(tampered)).toThrow('Failed to decrypt payload: authentication check failed');
    });

    it('throws on an unknown key-version prefix', () => {
        const ciphertext = encrypt('token');
        const withoutVersion = ciphertext.split(':').slice(1).join(':');
        const tampered = `v2:${withoutVersion}`;

        expect(() => decrypt(tampered)).toThrow('Unknown or malformed encrypted payload');
    });

    it('throws on a malformed payload', () => {
        expect(() => decrypt('not-a-valid-payload')).toThrow('Unknown or malformed encrypted payload');
    });

    it('throws when SPOTIFY_TOKEN_ENC_KEY is not 32 bytes', () => {
        process.env.SPOTIFY_TOKEN_ENC_KEY = Buffer.from('too-short').toString('base64');

        expect(() => encrypt('token')).toThrow('SPOTIFY_TOKEN_ENC_KEY must decode to 32 bytes');

        process.env.SPOTIFY_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
    });

    it('throws when SPOTIFY_TOKEN_ENC_KEY is unset', () => {
        delete process.env.SPOTIFY_TOKEN_ENC_KEY;

        expect(() => encrypt('token')).toThrow('SPOTIFY_TOKEN_ENC_KEY must decode to 32 bytes');

        process.env.SPOTIFY_TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64');
    });

    it('throws when the payload is not a string', () => {
        expect(() => decrypt(null)).toThrow('Unknown or malformed encrypted payload');
        expect(() => decrypt(undefined)).toThrow('Unknown or malformed encrypted payload');
        expect(() => decrypt(123)).toThrow('Unknown or malformed encrypted payload');
    });
});
