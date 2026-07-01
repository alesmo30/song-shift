const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

const formatJoiErrors = (error) => {
    if (!error || !error.details) return {};

    return error.details.reduce((acc, detail) => {
        const key = detail.path.join('.');
        // Clean double quotes around field names in the message
        const cleanMessage = detail.message.replace(/['"]/g, '');
        acc[key] = cleanMessage;
        return acc;
    }, {});
};

const schema = Joi.object({
    username: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(6).max(128).required()
});

const tokenSchemaValidation = (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    tokenSchemaValidation
};


