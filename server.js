

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const passport = require('passport');
const { authRouter } = require('./router/auth.router');
const { userRouter } = require('./router/user.router');
const { errorHandler } = require('./middlewares/error.handler')
const { jwtStrategy } = require('./utils/passport/passport');

const server = express();

server.use(helmet());
server.use(cors());
server.use(express.json());

server.use(passport.initialize());
passport.use('jwt', jwtStrategy);

server.use(authRouter);
server.use(userRouter);

server.use(errorHandler);

module.exports = server;








