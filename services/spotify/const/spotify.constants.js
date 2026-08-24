const SPOTIFY_SCOPES = [
    'playlist-read-private',
    'playlist-modify-private',
    'playlist-modify-public',
    'user-read-private',
    'user-read-email'
]

const SPOTIFY_ACCOUNTS_BASE_URL = 'https://accounts.spotify.com'
const SPOTIFY_API_BASE_URL = 'https://api.spotify.com'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const ACCESS_TOKEN_EXPIRY_MARGIN_MS = 60 * 1000

module.exports = {
    SPOTIFY_SCOPES,
    SPOTIFY_ACCOUNTS_BASE_URL,
    SPOTIFY_API_BASE_URL,
    OAUTH_STATE_TTL_MS,
    ACCESS_TOKEN_EXPIRY_MARGIN_MS
}
