const multer = require('multer');

// Armazena em memória (buffer) — necessário porque cada arquivo passa
// pela esteira do Sharp antes de ser gravado na nuvem, e o original
// também precisa ir para o bucket privado.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB de folga (originais chegam a 20MB)
  },
  fileFilter: (req, file, cb) => {
    const permitido = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (!permitido) return cb(new Error('Formato de arquivo não suportado.'));
    cb(null, true);
  },
});

module.exports = upload;
