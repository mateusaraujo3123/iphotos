const express = require('express');
const router = express.Router();
const { listarEventos, detalharEvento } = require('../controllers/eventController');

router.get('/', listarEventos);
router.get('/:id', detalharEvento);

module.exports = router;
