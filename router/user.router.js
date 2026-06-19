const { saveUser, getUser } = require('../services/users/user');
const express = require('express');
const { userSchemaValidation } = require('../middlewares/user-schema.validation');
const router = express.Router();

router.post('/users', userSchemaValidation, saveUser);
router.get('/users/:id', getUser);

module.exports = { userRouter: router };
