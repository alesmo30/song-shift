const handleServiceError = (res, error, fallbackMessage) => {
    const statusCode = error.statusCode || 500;
    const message = 'message' in error ? error.message : fallbackMessage;

    return res.status(statusCode).send({ message });
};

module.exports = {
    handleServiceError
};
