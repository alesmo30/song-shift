const mongoose = require('mongoose');


const spotifyOAuthStateSchema = new mongoose.Schema({
    state: {
        type: String,
        required: true,
        unique: true
    },
    user: {
        type: String,
        required: true
    },
    redirectPath: {
        type: String,
        default: '/'
    },
    expiresAt: {
        type: Date,
        required: true,
        expires: 0
    },
    consumedAt: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SpotifyOAuthState', spotifyOAuthStateSchema);
