const { login } = require('../services/auth/auth');
const express = require('express');
const { loginSchemaValidation } = require('../middlewares/login-schema.validation');
const { authRateLimiter } = require('../middlewares/rate-limiter');
const router = express.Router();

router.post('/login', authRateLimiter, loginSchemaValidation, login);

module.exports = { authRouter: router };
