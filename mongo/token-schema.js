const mongoose = require('mongoose');


const tokenSchema = new mongoose.Schema({
    accessToken: {
        type: String,
        required: true
    },
    accessTokenExpiresAt: {
        type: Date,
        required: true
    },
    refreshToken: {
        type: String,
        required: true
    },
    refreshTokenExpiresAt: {
        type: Date,
        required: true
    },
    user: {
        type: String,
        required: true
    },
    active: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    deletedAt: {
        type: Date,
    }
});

module.exports = mongoose.model('Token', tokenSchema);
