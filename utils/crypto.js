const crypto = require('crypto');
const { AppError } = require('./errors');

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';
const IV_LENGTH = 12;

const getKey = () => {
    const key = Buffer.from(process.env.SPOTIFY_TOKEN_ENC_KEY || '', 'base64');
    if (key.length !== 32) {
        throw new AppError('SPOTIFY_TOKEN_ENC_KEY must decode to 32 bytes', 500);
    }
    return key;
};

const encrypt = (plaintext) => {
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        KEY_VERSION,
        iv.toString('base64'),
        authTag.toString('base64'),
        ciphertext.toString('base64')
    ].join(':');
};

const decrypt = (payload) => {
    const parts = typeof payload === 'string' ? payload.split(':') : [];

    if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
        throw new AppError('Unknown or malformed encrypted payload', 500);
    }

    const [, ivB64, authTagB64, ciphertextB64] = parts;
    const key = getKey();

    try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));

        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(ciphertextB64, 'base64')),
            decipher.final()
        ]);

        return plaintext.toString('utf8');
    } catch {
        throw new AppError('Failed to decrypt payload: authentication check failed', 500);
    }
};

module.exports = {
    encrypt,
    decrypt
};
