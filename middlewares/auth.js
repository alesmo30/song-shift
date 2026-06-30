const passport = require('passport');
const { AuthenticationError } = require('../utils/errors');
const verifyCallBack = (req, resolve, reject) => (err, user, info) => {
    // Si hay error de servidor, error del token (info) o el usuario no existe
    if (err || info || !user) {
        const error = new AuthenticationError('User not authorized, please try again');
        return reject(error);
    }

    // Guardar el usuario en el objeto request para usarlo en los controladores
    req.user = user;
    resolve();
};

const auth = async (req, res, next) => {
    return new Promise((resolve, reject) => {
        passport.authenticate(
            'jwt',
            { session: false },
            verifyCallBack(req, resolve, reject)
        )(req, res, next);
    })
        .then(() => next())
        .catch((error) => next(error)); // Envía el error al Middleware de errores de Express
};

module.exports = auth;
