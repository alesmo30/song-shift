const { AppError } = require('../../utils/errors');
const { extractSongsFromImage } = require('./groq.client');

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
});

describe('services/groq/groq.client', () => {
    beforeEach(() => {
        process.env.GROQ_API_KEY = 'test-key';
        process.env.GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
        global.fetch = jest.fn();
    });

    describe('extractSongsFromImage', () => {
        it('returns the songs parsed from a successful response', async () => {
            const songs = [{ title: 'Song', artist: 'Artist', duration: '3:24', confidence: 90 }];
            global.fetch.mockResolvedValue(jsonResponse(200, {
                choices: [{ message: { content: JSON.stringify({ songs }) } }]
            }));

            const result = await extractSongsFromImage('base64data', 'image/png');

            expect(result).toEqual(songs);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(global.fetch).toHaveBeenCalledWith(
                'https://api.groq.com/openai/v1/chat/completions',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({ Authorization: 'Bearer test-key' })
                })
            );
        });

        it('returns an empty array when the response has no songs array', async () => {
            global.fetch.mockResolvedValue(jsonResponse(200, {
                choices: [{ message: { content: JSON.stringify({}) } }]
            }));

            const result = await extractSongsFromImage('base64data', 'image/png');

            expect(result).toEqual([]);
        });

        it('throws AppError 502 when the content is malformed JSON', async () => {
            global.fetch.mockResolvedValue(jsonResponse(200, {
                choices: [{ message: { content: 'not json' } }]
            }));

            await expect(extractSongsFromImage('base64data', 'image/png')).rejects.toMatchObject({
                message: 'Groq extraction failed',
                statusCode: 502
            });
            await expect(extractSongsFromImage('base64data', 'image/png')).rejects.toBeInstanceOf(AppError);
        });

        it('retries once on 429 and succeeds on the second attempt', async () => {
            jest.useFakeTimers();

            const songs = [{ title: 'Song', artist: 'Artist', duration: null, confidence: 80 }];
            global.fetch
                .mockResolvedValueOnce(jsonResponse(429, {}))
                .mockResolvedValueOnce(jsonResponse(200, {
                    choices: [{ message: { content: JSON.stringify({ songs }) } }]
                }));

            const promise = extractSongsFromImage('base64data', 'image/png');
            await jest.advanceTimersByTimeAsync(500);
            const result = await promise;

            expect(result).toEqual(songs);
            expect(global.fetch).toHaveBeenCalledTimes(2);

            jest.useRealTimers();
        });

        it('gives up after the retry budget on repeated 429s and throws AppError 502', async () => {
            jest.useFakeTimers();

            global.fetch.mockResolvedValue(jsonResponse(429, {}));

            const promise = extractSongsFromImage('base64data', 'image/png');
            const assertion = expect(promise).rejects.toMatchObject({
                message: 'Groq extraction failed',
                statusCode: 502
            });
            await jest.advanceTimersByTimeAsync(500);
            await jest.advanceTimersByTimeAsync(1000);
            await assertion;

            expect(global.fetch).toHaveBeenCalledTimes(3);

            jest.useRealTimers();
        });

        it('throws AppError 502 on a 500 without retrying past the budget', async () => {
            jest.useFakeTimers();

            global.fetch.mockResolvedValue(jsonResponse(500, {}));

            const promise = extractSongsFromImage('base64data', 'image/png');
            const assertion = expect(promise).rejects.toMatchObject({
                message: 'Groq extraction failed',
                statusCode: 502
            });
            await jest.advanceTimersByTimeAsync(500);
            await jest.advanceTimersByTimeAsync(1000);
            await assertion;

            jest.useRealTimers();
        });

        it('throws AppError 502 on a non-retryable status like 401, without retrying', async () => {
            global.fetch.mockResolvedValue(jsonResponse(401, {}));

            await expect(extractSongsFromImage('base64data', 'image/png')).rejects.toMatchObject({
                message: 'Groq extraction failed',
                statusCode: 502
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        it('throws AppError 502 when fetch itself rejects with a network error', async () => {
            global.fetch.mockRejectedValue(new Error('network down'));

            await expect(extractSongsFromImage('base64data', 'image/png')).rejects.toMatchObject({
                message: 'Groq extraction failed',
                statusCode: 502
            });
        });
    });
});
