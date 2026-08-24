const { get } = require('lodash');

const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;
const EXTRACTION_FAILED_MESSAGE = 'Gemini extraction failed';

const EXTRACTION_PROMPT = 'You are reading a screenshot of the Apple Music app on a phone. '
    + 'Each song is shown as a row with the track title on top, the artist name below it '
    + '(sometimes followed by " — " and an album name, which you must ignore), and the track '
    + 'duration formatted as "m:ss" on the right side of the row. '
    + 'List every song row visible in the image. For each one return its title, its artist '
    + '(never the album), its duration exactly as shown (or null if it is not visible), and a '
    + 'confidence score from 0 to 100 for how legible that row was.';

const SONGS_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        songs: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    title: { type: 'STRING' },
                    artist: { type: 'STRING' },
                    duration: { type: 'STRING', nullable: true },
                    confidence: { type: 'NUMBER' }
                },
                required: ['title', 'artist', 'duration', 'confidence']
            }
        }
    },
    required: ['songs']
};

const isRetryableStatus = (status) => status === 429 || status >= 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildRequestBody = (base64, mimeType) => ({
    contents: [
        {
            parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: mimeType, data: base64 } }
            ]
        }
    ],
    generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: SONGS_RESPONSE_SCHEMA
    }
});

const callGemini = async (base64, mimeType, attempt = 0) => {
    const model = process.env.GEMINI_VISION_MODEL;
    const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY
        },
        body: JSON.stringify(buildRequestBody(base64, mimeType))
    });

    if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
            const backoffMs = BASE_BACKOFF_MS * 2 ** attempt;
            logger.error(`[GeminiClient] Retryable status ${response.status}, attempt ${attempt + 1} of ${MAX_RETRIES}`);
            await sleep(backoffMs);
            return callGemini(base64, mimeType, attempt + 1);
        }

        logger.error(`[GeminiClient] Gemini request failed with status ${response.status}`);
        throw new AppError(EXTRACTION_FAILED_MESSAGE, 502);
    }

    return response.json();
};

const extractSongsFromImage = async (base64, mimeType) => {
    let data;

    try {
        data = await callGemini(base64, mimeType);
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }

        logger.error(`[GeminiClient] Network error: ${error.message}`);
        throw new AppError(EXTRACTION_FAILED_MESSAGE, 502);
    }

    const content = get(data, 'candidates[0].content.parts[0].text');

    try {
        const songs = get(JSON.parse(content), 'songs');
        return Array.isArray(songs) ? songs : [];
    } catch (error) {
        logger.error(`[GeminiClient] Malformed JSON in Gemini response: ${error.message}`);
        throw new AppError(EXTRACTION_FAILED_MESSAGE, 502);
    }
};

module.exports = {
    extractSongsFromImage
};
