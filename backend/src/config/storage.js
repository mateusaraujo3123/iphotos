/**
 * Camada de abstração de armazenamento em nuvem.
 *
 * Regra de negócio (item 4 do briefing): cada FOTÓGRAFO pode ter suas fotos
 * roteadas para um provedor diferente (S3 ou R2), escolhido pelo admin no
 * campo `provedorNuvem` do model Usuario. Como R2 é compatível com a API S3,
 * usamos o mesmo SDK (@aws-sdk/client-s3) trocando apenas o client/endpoint.
 */
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Retorna o client + nomes de bucket + base URL pública corretos
 * de acordo com o provedor configurado para o fotógrafo (R2 ou S3).
 */
function resolverProvedor(provedorNuvem) {
  if (provedorNuvem === 'S3') {
    return {
      client: s3Client,
      bucketPrivado: process.env.S3_BUCKET_PRIVADO,
      bucketPublico: process.env.S3_BUCKET_PUBLICO,
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    };
  }
  // Padrão: Cloudflare R2 (mais barato para egress de imagens pesadas)
  return {
    client: r2Client,
    bucketPrivado: process.env.R2_BUCKET_PRIVADO,
    bucketPublico: process.env.R2_BUCKET_PUBLICO,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  };
}

/**
 * Sobe o ORIGINAL (intacto, alta resolução) para o bucket PRIVADO.
 */
async function salvarOriginalPrivado({ provedorNuvem, chave, buffer, contentType }) {
  const { client, bucketPrivado } = resolverProvedor(provedorNuvem);
  await client.send(
    new PutObjectCommand({
      Bucket: bucketPrivado,
      Key: chave,
      Body: buffer,
      ContentType: contentType,
      // Nunca público — bucket deve ter Block Public Access habilitado no provedor
    })
  );
  return chave;
}

/**
 * Sobe a versão COMPRIMIDA + com marca d'água para o bucket PÚBLICO.
 */
async function salvarPublico({ provedorNuvem, chave, buffer, contentType }) {
  const { client, bucketPublico, publicBaseUrl } = resolverProvedor(provedorNuvem);
  await client.send(
    new PutObjectCommand({
      Bucket: bucketPublico,
      Key: chave,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
    })
  );
  return `${publicBaseUrl}/${chave}`;
}

/**
 * Gera uma URL assinada e temporária (expira em `expiresInSeconds`) para
 * o cliente baixar o arquivo ORIGINAL do bucket privado após o pagamento.
 */
async function gerarUrlAssinadaDownload({ provedorNuvem, chave, expiresInSeconds = 300 }) {
  const { client, bucketPrivado } = resolverProvedor(provedorNuvem);
  const comando = new GetObjectCommand({ Bucket: bucketPrivado, Key: chave });
  return getSignedUrl(client, comando, { expiresIn: expiresInSeconds });
}

/**
 * Exclusão física e permanente de um conjunto de objetos (original + público)
 * — usada pela função "Deletar Tudo" do admin e pelo cron de expiração de 30 dias.
 */
async function excluirObjetos({ provedorNuvem, chavesPrivadas = [], chavesPublicas = [] }) {
  const { client, bucketPrivado, bucketPublico } = resolverProvedor(provedorNuvem);

  if (chavesPrivadas.length) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketPrivado,
        Delete: { Objects: chavesPrivadas.map((Key) => ({ Key })) },
      })
    );
  }
  if (chavesPublicas.length) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucketPublico,
        Delete: { Objects: chavesPublicas.map((Key) => ({ Key })) },
      })
    );
  }
}

module.exports = {
  resolverProvedor,
  salvarOriginalPrivado,
  salvarPublico,
  gerarUrlAssinadaDownload,
  excluirObjetos,
};
