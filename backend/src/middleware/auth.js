const jwt = require('jsonwebtoken');

/**
 * Exige um usuário (CLIENTE ou FOTOGRAFO) autenticado.
 * Espera header: Authorization: Bearer <token>
 */
function exigirAutenticacao(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido.' });
  }

  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = payload; // { id, papel, nome, email }
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

/**
 * Exige que o usuário autenticado tenha o papel FOTOGRAFO.
 */
function exigirFotografo(req, res, next) {
  if (req.usuario?.papel !== 'FOTOGRAFO') {
    return res.status(403).json({ erro: 'Acesso restrito a fotógrafos.' });
  }
  next();
}

module.exports = { exigirAutenticacao, exigirFotografo };
