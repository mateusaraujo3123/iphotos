const express = require('express');
const router = express.Router();
const { exigirAutenticacao } = require('../middleware/auth');
const { criarPedido, buscarPedido, minhasCompras } = require('../controllers/orderController');

router.use(exigirAutenticacao);

router.post('/', criarPedido);
router.get('/', minhasCompras);
router.get('/:id', buscarPedido);

module.exports = router;
