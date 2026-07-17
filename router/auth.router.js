const { login, renewTokens } = require('../services/auth/auth');
const express = require('express');
const { loginSchemaValidation } = require('../middlewares/login-schema.validation');
const router = express.Router();

router.post('/login', loginSchemaValidation, login);
router.post('/renew-token', renewTokens)

module.exports = { authRouter: router };
