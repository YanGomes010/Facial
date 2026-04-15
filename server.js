/**
 * BioID — Backend Express
 * Gerencia conexão com NocoDB e serve o frontend estático.
 */

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Configurações lidas do .env ───────────────────────────
const NC_URL   = (process.env.NOCODB_URL   || '').replace(/\/$/, '');
const NC_TOKEN = process.env.NOCODB_TOKEN  || '';
const NC_TABLE = process.env.NOCODB_TABLE_ID || '';

function ncHeaders() {
  return { 'Content-Type': 'application/json', 'xc-token': NC_TOKEN };
}

function isConfigured() {
  return Boolean(NC_URL && NC_TOKEN && NC_TABLE);
}

function getExtensionFromMime(mime = '') {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'application/pdf': 'pdf',
  };
  return map[mime] || 'bin';
}

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('Documento inválido. Envie imagem ou PDF em base64.');
  }

  const mime = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, 'base64');

  return { mime, buffer };
}

async function uploadAttachmentToNocoDB(dataUrl, preferredName = 'documento') {
  const { mime, buffer } = parseDataUrl(dataUrl);
  const ext = getExtensionFromMime(mime);
  const fileName = `${preferredName}.${ext}`;

  const form = new FormData();
  const blob = new Blob([buffer], { type: mime });
  form.append('file', blob, fileName);

  const uploadUrl = `${NC_URL}/api/v2/storage/upload`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'xc-token': NC_TOKEN },
    body: form,
  });

  if (!uploadRes.ok) {
    throw new Error(`Falha no upload do documento: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  const uploaded = await uploadRes.json();

  if (Array.isArray(uploaded)) return uploaded;
  if (Array.isArray(uploaded?.data)) return uploaded.data;
  if (Array.isArray(uploaded?.files)) return uploaded.files;
  if (uploaded?.url) return [uploaded];

  throw new Error('Resposta inesperada do upload do NocoDB.');
}

// ── Middleware: verifica se .env está configurado ─────────
function requireConfig(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Backend não configurado. Verifique o arquivo .env.' });
  }
  next();
}

// ── GET /api/status ───────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({ configured: isConfigured(), version: '1.0.0' });
});

// ── GET /api/user/:cpf ────────────────────────────────────
app.get('/api/user/:cpf', requireConfig, async (req, res) => {
  try {
    const cpf = req.params.cpf.replace(/\D/g, '');
    if (cpf.length !== 11) {
      return res.status(400).json({ error: 'CPF inválido' });
    }

    const url = `${NC_URL}/api/v2/tables/${NC_TABLE}/records?where=(cpf,eq,${cpf})&limit=1`;
    console.log('Buscando URL:', url);

    const r = await fetch(url, {
      headers: ncHeaders(),
    });

    if (!r.ok) {
      throw new Error(`NocoDB ${r.status}: ${await r.text()}`);
    }

    const data = await r.json();
    const user = data.list?.[0] || null;

    if (user && user.documento_foto) {
      user.documento_foto = '[base64 omitido]';
    }

    res.json(user);
  } catch (e) {
    console.error('[GET /api/user] erro completo:', e);
    res.status(500).json({
      error: e.message,
      cause: e.cause?.code || null,
      hostname: e.cause?.hostname || null,
    });
  }
});

// ── POST /api/user ────────────────────────────────────────
app.post('/api/user', requireConfig, async (req, res) => {
  try {
    const { nome, cpf, data_nascimento, email, telefone, face_descriptor, documento_foto } = req.body;

    if (!nome || !cpf || !face_descriptor) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, cpf, face_descriptor' });
    }

    if (!documento_foto) {
      return res.status(400).json({ error: 'Documento oficial é obrigatório.' });
    }

    const cpfLimpo = cpf.replace(/\D/g, '');

    const checkUrl = `${NC_URL}/api/v2/tables/${NC_TABLE}/records?where=(cpf,eq,${cpfLimpo})&limit=1`;
    const checkR = await fetch(checkUrl, { headers: ncHeaders() });
    if (checkR.ok) {
      const existing = await checkR.json();
      if (existing.list?.length > 0) {
        return res.status(409).json({ error: 'CPF já cadastrado' });
      }
    }

    const attachments = await uploadAttachmentToNocoDB(documento_foto, `documento_${cpfLimpo}`);

    const payload = {
      nome,
      cpf: cpfLimpo,
      data_nascimento,
      email,
      telefone,
      face_descriptor,
      documento_foto: attachments,
    };

    const url = `${NC_URL}/api/v2/tables/${NC_TABLE}/records`;
    const r = await fetch(url, {
      method: 'POST',
      headers: ncHeaders(),
      body: JSON.stringify(payload)
    });

    if (!r.ok) throw new Error(`NocoDB ${r.status}: ${await r.text()}`);

    res.json(await r.json());
  } catch (e) {
    console.error('[POST /api/user]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/setup — cria tabela automaticamente ──────────
app.post('/api/setup', requireConfig, async (req, res) => {
  try {
    const basesUrl = `${NC_URL}/api/v2/meta/bases`;
    const bR = await fetch(basesUrl, { headers: ncHeaders() });
    if (!bR.ok) throw new Error('Falha ao listar bases');

    const bases = await bR.json();
    const base  = (bases.list || bases)[0];
    if (!base) throw new Error('Nenhuma base encontrada no NocoDB');

    const tblUrl = `${NC_URL}/api/v2/meta/bases/${base.id}/tables`;
    const body   = {
      title: 'usuarios',
      columns: [
        { column_name: 'nome',             uidt: 'SingleLineText', pv: true },
        { column_name: 'cpf',              uidt: 'SingleLineText' },
        { column_name: 'data_nascimento',  uidt: 'SingleLineText' },
        { column_name: 'email',            uidt: 'Email' },
        { column_name: 'telefone',         uidt: 'SingleLineText' },
        { column_name: 'face_descriptor',  uidt: 'LongText' },
        { column_name: 'documento_foto',   uidt: 'Attachment' },
      ]
    };

    const tR = await fetch(tblUrl, { method: 'POST', headers: ncHeaders(), body: JSON.stringify(body) });
    if (!tR.ok) throw new Error(`Erro criar tabela: ${await tR.text()}`);

    const tbl = await tR.json();
    res.json({ tableId: tbl.id, title: tbl.title });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Fallback: serve o index.html para qualquer rota ──────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Inicia servidor ───────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});