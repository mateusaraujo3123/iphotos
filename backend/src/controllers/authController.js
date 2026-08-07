const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

function assinarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

/**
 * POST /api/auth/cadastro
 * body: { nome, email, senha, papel: 'CLIENTE' | 'FOTOGRAFO', whatsapp?, chavePix? }
 * Observação: o campo de localização (estado/cidade) foi removido do cadastro
 * de fotógrafos por solicitação explícita — não existe no model Usuario.
 */
async function cadastrar(req, res) {
  try {
    const { nome, email, senha, papel, whatsapp, chavePix } = req.body;

    if (!nome || !email || !senha || !papel) {
      return res.status(400).json({ erro: 'Preencha nome, email, senha e papel.' });
    }
    if (!['CLIENTE', 'FOTOGRAFO'].includes(papel)) {
      return res.status(400).json({ erro: 'Papel inválido.' });
    }

    const jaExiste = await prisma.usuario.findUnique({ where: { email } });
    if (jaExiste) {
      return res.status(409).json({ erro: 'Já existe uma conta com este email.' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        senhaHash,
        papel,
        whatsapp: whatsapp || null,
        chavePix: papel === 'FOTOGRAFO' ? chavePix || null : null,
      },
    });

    const token = assinarToken(usuario);
    return res.status(201).json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Erro ao cadastrar usuário.' });
  }
}

/**
 * POST /api/auth/login
 * body: { email, senha }
 */
async function login(req, res) {
  try {
    const { email, senha } = req.body;
    const usuario = await prisma.usuario.findUnique({ where: { email } });

    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ erro: 'Email ou senha inválidos.' });
    }

    const senhaConfere = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaConfere) {
      return res.status(401).json({ erro: 'Email ou senha inválidos.' });
    }

    const token = assinarToken(usuario);
    return res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: 'Erro ao efetuar login.' });
  }
}

/**
 * GET /api/auth/me — retorna os dados do usuário logado (valida o token)
 */
async function me(req, res) {
  const usuario = await prisma.usuario.findUnique({
    where: { id: req.usuario.id },
    select: { id: true, nome: true, email: true, papel: true, whatsapp: true, chavePix: true },
  });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(usuario);
}

module.exports = { cadastrar, login, me };
