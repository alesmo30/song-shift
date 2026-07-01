const { login } = require('../services/auth/auth');
const express = require('express');
const { loginSchemaValidation } = require('../middlewares/login-schema.validation');
const router = express.Router();

router.post('/login', loginSchemaValidation, login);

module.exports = { authRouter: router };
