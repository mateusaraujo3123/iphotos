const express = require('express');
const router = express.Router();
const { exigirAutenticacao, exigirFotografo } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/photographerController');

router.use(exigirAutenticacao, exigirFotografo);

router.post('/eventos', ctrl.criarEvento);
router.get('/eventos', ctrl.meusEventos);
router.post('/eventos/:id/fotos', upload.array('fotos', 60), ctrl.enviarLoteFotos);
router.get('/faturamento', ctrl.faturamento);
router.put('/perfil', ctrl.atualizarPerfil);
router.post('/saques', ctrl.solicitarSaque);
router.get('/saques', ctrl.meusSaques);

module.exports = router;
