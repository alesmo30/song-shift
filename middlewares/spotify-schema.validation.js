const Joi = require('joi');
const { ValidationError } = require('../utils/errors');
const { formatJoiErrors } = require('../utils/validation');

const authUrlSchema = Joi.object({
    redirectPath: Joi.string()
        .pattern(/^\/(?!\/)/)
        .default('/')
        .messages({
            'string.pattern.base': 'redirectPath must be a relative path starting with a single "/"'
        })
});

const authUrlSchemaValidation = (req, res, next) => {
    const { error, value } = authUrlSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    authUrlSchemaValidation
};
