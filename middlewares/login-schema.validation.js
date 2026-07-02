const Joi = require('joi');
const { ValidationError } = require('../utils/errors');
const { formatJoiErrors } = require('../utils/validation');

const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
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
