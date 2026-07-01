const Joi = require('joi');
const { ValidationError } = require('../utils/errors');

const formatJoiErrors = (error) => {
    if (!error || !error.details) return {};

    return error.details.reduce((acc, detail) => {
        const key = detail.path.join('.');
        const cleanMessage = detail.message.replace(/['"]/g, '');
        acc[key] = cleanMessage;
        return acc;
    }, {});
};

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().max(128).required()
});

const loginSchemaValidation = (req, res, next) => {
    const { error, value } = loginSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    loginSchemaValidation
};
