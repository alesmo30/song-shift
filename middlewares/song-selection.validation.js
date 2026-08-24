const Joi = require('joi');
const { ValidationError } = require('../utils/errors');
const { formatJoiErrors } = require('../utils/validation');

const songSelectionSchema = Joi.object({
    songs: Joi.array()
        .items(
            Joi.object({
                id: Joi.string().required(),
                title: Joi.string().required(),
                artist: Joi.string().required(),
                duration: Joi.string().allow(null)
            })
        )
        .min(1)
        .max(100)
        .required()
});

const songSelectionValidation = (req, res, next) => {
    const { error, value } = songSelectionSchema.validate(req.body, { abortEarly: false });

    if (error) {
        throw new ValidationError(formatJoiErrors(error));
    }

    req.body = value;
    next();
};

module.exports = {
    songSelectionValidation
};
