const { mapWithConcurrency } = require('./concurrency');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('utils/concurrency', () => {
    describe('mapWithConcurrency', () => {
        it('returns results in the same order as the input items', async () => {
            const items = [30, 10, 20, 5];
            const result = await mapWithConcurrency(items, 2, async (item) => {
                await sleep(item);
                return item * 2;
            });

            expect(result).toEqual([60, 20, 40, 10]);
        });

        it('never runs more than limit promises at the same time', async () => {
            let active = 0;
            let maxActive = 0;

            await mapWithConcurrency([1, 2, 3, 4, 5, 6], 3, async (item) => {
                active += 1;
                maxActive = Math.max(maxActive, active);
                await sleep(5);
                active -= 1;
                return item;
            });

            expect(maxActive).toBeLessThanOrEqual(3);
        });

        it('resolves each item through fn exactly once', async () => {
            const calls = [];
            await mapWithConcurrency(['a', 'b', 'c'], 5, async (item, index) => {
                calls.push([item, index]);
                return item;
            });

            expect(calls).toEqual([['a', 0], ['b', 1], ['c', 2]]);
        });

        it('returns an empty array for an empty input', async () => {
            const result = await mapWithConcurrency([], 5, async (item) => item);
            expect(result).toEqual([]);
        });

        it('works when limit is greater than the number of items', async () => {
            const result = await mapWithConcurrency([1, 2], 10, async (item) => item + 1);
            expect(result).toEqual([2, 3]);
        });

        it('propagates a rejection from fn', async () => {
            await expect(
                mapWithConcurrency([1, 2, 3], 2, async (item) => {
                    if (item === 2) throw new Error('boom');
                    return item;
                })
            ).rejects.toThrow('boom');
        });
    });
});
