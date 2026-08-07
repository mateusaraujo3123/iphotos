const jwt = require('jsonwebtoken');

/**
 * Protege todas as rotas do painel admin.
 * O token é emitido em POST /api/admin/login mediante a senha master (ADMIN_PASSWORD).
 */
function exigirAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token admin não fornecido.' });
  }

  const token = header.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    if (payload.papel !== 'ADMIN') throw new Error('papel inválido');
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Sessão admin inválida ou expirada.' });
  }
}

module.exports = { exigirAdmin };
