const { AuthorizationError } = require('../utils/errors');

const checkRole = (roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return next(new AuthorizationError('You do not have permission to perform this action'));
    }
    next();
};

module.exports = checkRole;
