const mapWithConcurrency = async (items, limit, fn) => {
    const results = new Array(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await fn(items[currentIndex], currentIndex);
        }
    };

    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);

    return results;
};

module.exports = {
    mapWithConcurrency
};
