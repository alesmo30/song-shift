const { get } = require('lodash');

const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const EXTRACTION_FAILED_MESSAGE = 'Groq extraction failed';

const EXTRACTION_PROMPT = 'You are reading a screenshot of the Apple Music app on a phone. '
    + 'Each song is shown as a row with the track title on top, the artist name below it '
    + '(sometimes followed by " — " and an album name, which you must ignore), and the track '
    + 'duration formatted as "m:ss" on the right side of the row. '
    + 'List every song row visible in the image. For each one return its title, its artist '
    + '(never the album), its duration exactly as shown (or null if it is not visible), and a '
    + 'confidence score from 0 to 100 for how legible that row was.';

const SONGS_JSON_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['songs'],
    properties: {
        songs: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'artist', 'duration', 'confidence'],
                properties: {
                    title: { type: 'string' },
                    artist: { type: 'string' },
                    duration: { type: ['string', 'null'] },
                    confidence: { type: 'number', minimum: 0, maximum: 100 }
                }
            }
        }
    }
};

const isRetryableStatus = (status) => status === 429 || status >= 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildRequestBody = (base64, mimeType) => ({
    model: process.env.GROQ_VISION_MODEL,
    temperature: 0,
    messages: [
        {
            role: 'user',
            content: [
                { type: 'text', text: EXTRACTION_PROMPT },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
            ]
        }
    ],
    response_format: {
        type: 'json_schema',
        json_schema: {
            name: 'apple_music_songs',
            strict: true,
            schema: SONGS_JSON_SCHEMA
        }
    }
});

const callGroq = async (base64, mimeType, attempt = 0) => {
    const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify(buildRequestBody(base64, mimeType))
    });

    if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            const backoffMs = BASE_BACKOFF_MS * 2 ** attempt;
            logger.error(`[GroqClient] Retryable status ${response.status}, attempt ${attempt + 1} of ${MAX_RETRIES}`);
            await sleep(backoffMs);
            return callGroq(base64, mimeType, attempt + 1);
        }

        logger.error(`[GroqClient] Groq request failed with status ${response.status}`);
        throw new AppError(EXTRACTION_FAILED_MESSAGE, 502);
    }

    return response.json();
};

const extractSongsFromImage = async (base64, mimeType) => {
    let data;

    try {
        data = await callGroq(base64, mimeType);
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }

        logger.error(`[GroqClient] Network error: ${error.message}`);
        throw new AppError(EXTRACTION_FAILED_MESSAGE, 502);
    }

    const content = get(data, 'choices[0].message.content');

    try {
        const songs = get(JSON.parse(content), 'songs');
        return Array.isArray(songs) ? songs : [];
    } catch (error) {
        logger.error(`[GroqClient] Malformed JSON in Groq response: ${error.message}`);
        throw new AppError(EXTRACTION_FAILED_MESSAGE, 502);
    }
};

module.exports = {
    extractSongsFromImage
};
