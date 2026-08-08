/**
 * Camada de abstração de armazenamento em nuvem — MULTI-PROVEDOR.
 *
 * Regra de negócio (item 4 do briefing): cada FOTÓGRAFO pode ter suas fotos
 * roteadas para um provedor diferente, escolhido pelo admin no campo
 * `provedorNuvem` do model Usuario.
 *
 * Por que só precisamos de UM SDK (@aws-sdk/client-s3) pra tudo isso:
 * praticamente todo provedor de object storage hoje fala o "protocolo S3"
 * (mesma API que a Amazon criou) — muda só o endpoint e as credenciais.
 * Isso cobre Cloudflare R2, AWS S3, Backblaze B2, Wasabi, DigitalOcean
 * Spaces, IDrive e2, Vultr, Linode/Akamai, Scaleway e Supabase Storage.
 *
 * Cada provedor só é inicializado (client criado) na hora em que é
 * realmente usado — então você pode deixar 9 provedores sem credencial
 * nenhuma no .env que o site continua funcionando normalmente; só dá erro
 * se alguém tentar subir foto pra um provedor que você não configurou.
 */
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/**
 * Configuração de cada provedor: como montar o client S3 e de onde vêm
 * os nomes de bucket / URL pública. Preenchido a partir do .env — deixe
 * em branco qualquer provedor que você não for usar.
 */
const CONFIG_PROVEDORES = {
  R2: {
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.R2_BUCKET_PRIVADO,
    bucketPublico: process.env.R2_BUCKET_PUBLICO,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  },
  S3: {
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: undefined, // S3 usa o endpoint padrão da AWS
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.S3_BUCKET_PRIVADO,
    bucketPublico: process.env.S3_BUCKET_PUBLICO,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
  },
  BACKBLAZE: {
    region: process.env.B2_REGION || 'us-west-004',
    endpoint: process.env.B2_ENDPOINT, // ex: https://s3.us-west-004.backblazeb2.com
    accessKeyId: process.env.B2_ACCESS_KEY_ID,
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.B2_BUCKET_PRIVADO,
    bucketPublico: process.env.B2_BUCKET_PUBLICO,
    publicBaseUrl: process.env.B2_PUBLIC_BASE_URL,
  },
  WASABI: {
    region: process.env.WASABI_REGION || 'us-east-1',
    endpoint: process.env.WASABI_ENDPOINT, // ex: https://s3.wasabisys.com
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID,
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.WASABI_BUCKET_PRIVADO,
    bucketPublico: process.env.WASABI_BUCKET_PUBLICO,
    publicBaseUrl: process.env.WASABI_PUBLIC_BASE_URL,
  },
  DIGITALOCEAN: {
    region: process.env.DO_REGION || 'nyc3',
    endpoint: process.env.DO_ENDPOINT, // ex: https://nyc3.digitaloceanspaces.com
    accessKeyId: process.env.DO_ACCESS_KEY_ID,
    secretAccessKey: process.env.DO_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.DO_BUCKET_PRIVADO,
    bucketPublico: process.env.DO_BUCKET_PUBLICO,
    publicBaseUrl: process.env.DO_PUBLIC_BASE_URL,
  },
  IDRIVE: {
    region: process.env.IDRIVE_REGION || 'us-west-1',
    endpoint: process.env.IDRIVE_ENDPOINT, // ex: https://xxxxx.idrivee2-xx.com
    accessKeyId: process.env.IDRIVE_ACCESS_KEY_ID,
    secretAccessKey: process.env.IDRIVE_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.IDRIVE_BUCKET_PRIVADO,
    bucketPublico: process.env.IDRIVE_BUCKET_PUBLICO,
    publicBaseUrl: process.env.IDRIVE_PUBLIC_BASE_URL,
  },
  VULTR: {
    region: process.env.VULTR_REGION || 'ewr1',
    endpoint: process.env.VULTR_ENDPOINT, // ex: https://ewr1.vultrobjects.com
    accessKeyId: process.env.VULTR_ACCESS_KEY_ID,
    secretAccessKey: process.env.VULTR_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.VULTR_BUCKET_PRIVADO,
    bucketPublico: process.env.VULTR_BUCKET_PUBLICO,
    publicBaseUrl: process.env.VULTR_PUBLIC_BASE_URL,
  },
  LINODE: {
    region: process.env.LINODE_REGION || 'us-east-1',
    endpoint: process.env.LINODE_ENDPOINT, // ex: https://us-east-1.linodeobjects.com
    accessKeyId: process.env.LINODE_ACCESS_KEY_ID,
    secretAccessKey: process.env.LINODE_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.LINODE_BUCKET_PRIVADO,
    bucketPublico: process.env.LINODE_BUCKET_PUBLICO,
    publicBaseUrl: process.env.LINODE_PUBLIC_BASE_URL,
  },
  SCALEWAY: {
    region: process.env.SCALEWAY_REGION || 'fr-par',
    endpoint: process.env.SCALEWAY_ENDPOINT, // ex: https://s3.fr-par.scw.cloud
    accessKeyId: process.env.SCALEWAY_ACCESS_KEY_ID,
    secretAccessKey: process.env.SCALEWAY_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.SCALEWAY_BUCKET_PRIVADO,
    bucketPublico: process.env.SCALEWAY_BUCKET_PUBLICO,
    publicBaseUrl: process.env.SCALEWAY_PUBLIC_BASE_URL,
  },
  SUPABASE: {
    region: process.env.SUPABASE_REGION || 'us-east-1',
    endpoint: process.env.SUPABASE_S3_ENDPOINT, // ex: https://xxxxx.supabase.co/storage/v1/s3
    accessKeyId: process.env.SUPABASE_ACCESS_KEY_ID,
    secretAccessKey: process.env.SUPABASE_SECRET_ACCESS_KEY,
    bucketPrivado: process.env.SUPABASE_BUCKET_PRIVADO,
    bucketPublico: process.env.SUPABASE_BUCKET_PUBLICO,
    publicBaseUrl: process.env.SUPABASE_PUBLIC_BASE_URL,
  },
};

// Clients são criados sob demanda e reaproveitados (cache simples em memória)
const clientsCriados = {};

function resolverProvedor(provedorNuvem) {
  const cfg = CONFIG_PROVEDORES[provedorNuvem];
  if (!cfg) {
    throw new Error(`Provedor de nuvem "${provedorNuvem}" não reconhecido.`);
  }
  if (!cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketPrivado || !cfg.bucketPublico) {
    throw new Error(
      `O provedor "${provedorNuvem}" ainda não foi configurado no .env (faltam credenciais ou nomes de bucket).`
    );
  }

  if (!clientsCriados[provedorNuvem]) {
    clientsCriados[provedorNuvem] = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: provedorNuvem !== 'S3', // a maioria dos provedores alternativos precisa disso
    });
  }

  return {
    client: clientsCriados[provedorNuvem],
    bucketPrivado: cfg.bucketPrivado,
    bucketPublico: cfg.bucketPublico,
    publicBaseUrl: cfg.publicBaseUrl,
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
      // Nunca público — bucket deve ter "Block Public Access" habilitado no provedor
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
  PROVEDORES_DISPONIVEIS: Object.keys(CONFIG_PROVEDORES),
  resolverProvedor,
  salvarOriginalPrivado,
  salvarPublico,
  gerarUrlAssinadaDownload,
  excluirObjetos,
};
