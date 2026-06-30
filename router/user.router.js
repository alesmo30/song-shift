const { saveUser, getUser } = require('../services/users/user');
const auth = require('../middlewares/auth');
const express = require('express');
const { userSchemaValidation } = require('../middlewares/user-schema.validation');
const router = express.Router();

router.post('/users', auth, userSchemaValidation, saveUser);
router.get('/users/:id', auth, getUser);

module.exports = { userRouter: router };
