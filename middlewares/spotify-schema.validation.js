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

const createPlaylistSchema = Joi.object({
    name: Joi.string().min(1).max(100).required()
});

const createPlaylistSchemaValidation = (req, res, next) => {
    const { error, value } = createPlaylistSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

const defaultPlaylistSchema = Joi.object({
    playlistId: Joi.string().allow(null).required()
});

const defaultPlaylistSchemaValidation = (req, res, next) => {
    const { error, value } = defaultPlaylistSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    authUrlSchemaValidation,
    createPlaylistSchemaValidation,
    defaultPlaylistSchemaValidation
};
