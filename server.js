

const express = require('express');
const { authRouter } = require('./router/auth.router');
const { userRouter } = require('./router/user.router');
const { errorHandler } = require('./middlewares/error.handler')

const server = express();

server.use(express.json())

server.use(authRouter);
server.use(userRouter);

server.use(errorHandler);

module.exports = server;








