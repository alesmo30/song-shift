const formatJoiErrors = (error) => {
    if (!error || !error.details) return {};

    return error.details.reduce((acc, detail) => {
        const key = detail.path.join('.');
        const cleanMessage = detail.message.replace(/['"]/g, '');
        acc[key] = cleanMessage;
        return acc;
    }, {});
};

module.exports = {
    formatJoiErrors
};
