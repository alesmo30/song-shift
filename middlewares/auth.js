const passport = require('passport');
const { AuthenticationError } = require('../utils/errors');

const verifyCallBack = (req, resolve, reject) => (err, user, info) => {
    if (err || info || !user) {
        return reject(new AuthenticationError('User not authorized, please try again'));
    }

    req.user = user;
    resolve();
};

const auth = (req, res, next) => {
    return new Promise((resolve, reject) => {
        passport.authenticate(
            'jwt',
            { session: false },
            verifyCallBack(req, resolve, reject)
        )(req, res, next);
    })
        .then(() => next())
        .catch((error) => next(error));
};

module.exports = auth;
