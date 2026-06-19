const { login } = require('../services/auth/auth');
const express = require('express');
const router = express.Router();

router.post('/login', login);

module.exports = { authRouter: router };
