const express = require('express');
const router = express.Router();
const { cadastrar, login, me } = require('../controllers/authController');
const { exigirAutenticacao } = require('../middleware/auth');

router.post('/cadastro', cadastrar);
router.post('/login', login);
router.get('/me', exigirAutenticacao, me);

module.exports = router;
