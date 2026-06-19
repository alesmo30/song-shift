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

const schema = Joi.object({
    name:     Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    email:    Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    role:     Joi.string().valid('USER', 'ADMIN').default('USER')
});

const userSchemaValidation = (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    userSchemaValidation
};
