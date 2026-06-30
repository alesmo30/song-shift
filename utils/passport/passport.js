const { isNil } = require('lodash');
const prisma = require('../../lib/prisma');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');


const jwtOptions = {
    secretOrKey: process.env.JWT_ACCESS_TOKEN_SECRET,
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
};

const jwtVerify = async (payload, done) => {
    try {
        const { email } = payload;
        const user = await prisma.user.findUnique({ where: { email } });


        if (isNil(user)) {
            return done(null, false);
        }

        done(null, user);
    } catch (error) {
        done(error, false);
    }
};

const jwtStrategy = new JwtStrategy(jwtOptions, jwtVerify);

module.exports = {
    jwtStrategy,
};
