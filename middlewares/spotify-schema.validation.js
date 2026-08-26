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

const matchSongsSchema = Joi.object({
    songs: Joi.array()
        .items(
            Joi.object({
                id: Joi.string().required(),
                title: Joi.string().required(),
                artist: Joi.string().required(),
                duration: Joi.string().allow(null),
                confidence: Joi.number().min(0).max(100)
            })
        )
        .min(1)
        .max(50)
        .required()
});

const matchSongsSchemaValidation = (req, res, next) => {
    const { error, value } = matchSongsSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

const addTracksSchema = Joi.object({
    uris: Joi.array()
        .items(Joi.string().pattern(/^spotify:track:[A-Za-z0-9]{22}$/))
        .min(1)
        .max(100)
        .required()
});

const addTracksSchemaValidation = (req, res, next) => {
    const { error, value } = addTracksSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    authUrlSchemaValidation,
    createPlaylistSchemaValidation,
    defaultPlaylistSchemaValidation,
    matchSongsSchemaValidation,
    addTracksSchemaValidation
};
