const express = require('express');
const router = express.Router();
const { exigirAutenticacao } = require('../middleware/auth');
const { webhook, gerarLinkDownload } = require('../controllers/paymentController');

router.post('/webhook', webhook);
router.get('/fotos/:id/download', exigirAutenticacao, gerarLinkDownload);

module.exports = router;
