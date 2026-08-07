require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/authRoutes');
const eventRoutes = require('./routes/eventRoutes');
const photographerRoutes = require('./routes/photographerRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { iniciarCronDeExpiracao } = require('./jobs/expirationCron');

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
  })
);

// Limite de requisições para reduzir abuso em rotas públicas (login, cadastro, etc.)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: '2mb' }));

app.get('/api/saude', (req, res) => res.json({ status: 'ok', servico: 'iphotos-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/eventos', eventRoutes);
app.use('/api/fotografo', photographerRoutes);
app.use('/api/pedidos', orderRoutes);
app.use('/api/pagamentos', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Tratamento central de erros (ex.: Multer, JSON malformado)
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message?.includes('não suportado') || err.message?.includes('File too large')) {
    return res.status(400).json({ erro: err.message });
  }
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`iphotos backend rodando na porta ${PORT}`);
  iniciarCronDeExpiracao();
});
