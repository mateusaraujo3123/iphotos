const express = require('express');
const router = express.Router();
const { exigirAdmin } = require('../middleware/adminAuth');
const ctrl = require('../controllers/adminController');

router.post('/login', ctrl.loginAdmin);

router.use(exigirAdmin);

router.get('/eventos', ctrl.listarTodosEventos);
router.delete('/eventos/:id', ctrl.deletarEvento);

router.get('/fotografos', ctrl.listarFotografos);
router.put('/fotografos/:id/provedor-nuvem', ctrl.definirProvedorNuvem);
router.put('/fotografos/:id/taxa', ctrl.definirTaxaComissao);

router.get('/usuarios', ctrl.listarUsuarios);
router.put('/usuarios/:id/resetar-senha', ctrl.resetarSenha);
router.delete('/usuarios/:id', ctrl.excluirUsuario);

router.post('/cupons', ctrl.criarCupom);
router.get('/cupons', ctrl.listarCupons);
router.put('/cupons/:id/status', ctrl.alternarStatusCupom);

router.get('/saques', ctrl.listarSaques);
router.put('/saques/:id/pagar', ctrl.marcarSaquePago);
router.put('/saques/:id/recusar', ctrl.recusarSaque);

router.get('/config', ctrl.obterConfig);
router.put('/config', ctrl.atualizarConfig);

module.exports = router;
