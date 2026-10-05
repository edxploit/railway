const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { calculateFreight } = require('./freight');

const app = express();
app.use(express.json());

const WHATICKET_URL = process.env.WHATICKET_URL || 'https://app.whaticket.com';
const WHATICKET_TOKEN = process.env.WHATICKET_TOKEN;
const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = 30000;

const SEQUENCES = {
  beliche: {
    images: [
      { file: 'beliche-preta.png',              label: 'Beliche Preta' },
      { file: 'beliche-natural-colchao.png',     label: 'Beliche Natural' },
      { file: 'beliche-imbuia.png',              label: 'Beliche Imbuia' },
      { file: 'beliche-natural-sem-colchao.png', label: 'Beliche Natural S/ Colchão' },
      { file: 'catalogo.jpg',                    label: 'Catálogo' },
    ],
    message: 'Qual seu CEP? 📍\nPagamento somente na entrega. ✅',
  },
  treliche: {
    images: [{ file: 'catalogo.jpg', label: 'Catálogo' }],
    message: 'Qual seu CEP? 📍\nPagamento somente na entrega. ✅',
  },
  'cama-bau': {
    images: [{ file: 'catalogo.jpg', label: 'Catálogo' }],
    message: 'Qual seu CEP? 📍\nPagamento somente na entrega. ✅',
  },
  colchao: {
    images: [{ file: 'catalogo.jpg', label: 'Catálogo' }],
    message: 'Qual seu CEP? 📍\nPagamento somente na entrega. ✅',
  },
  default: {
    images: [{ file: 'catalogo.jpg', label: 'Catálogo' }],
    message: 'Qual seu CEP? 📍\nPagamento somente na entrega. ✅',
  },
};

const activeSequences = new Set();
const processedMessages = new Set();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function extractCep(text) {
  if (!text) return null;
  const match = text.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}${match[2]}` : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function api(method, endpoint, data) {
  try {
    const res = await axios({
      method,
      url: `${WHATICKET_URL}/api${endpoint}`,
      data,
      headers: { Authorization: `Bearer ${WHATICKET_TOKEN}` },
      timeout: 10000,
    });
    return res.data;
  } catch (err) {
    log(`API erro [${endpoint}]: ${err.response?.data?.message || err.message}`);
    return null;
  }
}

async function getTicketMessages(ticketId) {
  const res = await api('get', `/messages/${ticketId}?pageNumber=1`);
  return res?.records || res?.messages || [];
}

async function sendImage(ticketId, file, label) {
  const imgPath = path.join(__dirname, 'images', file);
  if (!fs.existsSync(imgPath)) { log(`Imagem não encontrada: ${file}`); return; }
  const form = new FormData();
  form.append('media', fs.createReadStream(imgPath), file);
  try {
    await axios.post(
      `${WHATICKET_URL}/api/messages/${ticketId}/media`,
      form,
      { headers: { ...form.getHeaders(), Authorization: `Bearer ${WHATICKET_TOKEN}` }, timeout: 30000 }
    );
    log(`✓ Imagem: ${label} → ticket ${ticketId}`);
  } catch (err) {
    log(`✗ Erro imagem ${label}: ${err.response?.data?.message || err.message}`);
  }
}

async function sendText(ticketId, text) {
  const res = await api('post', '/messages', { ticketId, body: text, fromMe: true });
  if (res) log(`✓ Texto enviado → ticket ${ticketId}`);
}

async function runSequence(ticketId, product) {
  const seq = SEQUENCES[product] || SEQUENCES.default;
  log(`▶ Sequência "${product}" → ticket ${ticketId}`);
  activeSequences.add(ticketId);

  for (let i = 0; i < seq.images.length; i++) {
    if (!activeSequences.has(ticketId)) { log(`⏹ Cancelado → ticket ${ticketId}`); return; }
    await sendImage(ticketId, seq.images[i].file, seq.images[i].label);
    if (i < seq.images.length - 1) await sleep(2000);
  }

  await sleep(3000);
  if (!activeSequences.has(ticketId)) { log(`⏹ Cancelado antes da msg final → ticket ${ticketId}`); return; }

  await sendText(ticketId, seq.message);
  activeSequences.delete(ticketId);
  log(`✅ Concluído → ticket ${ticketId}`);
}

async function handleCep(ticketId, messageId, cep) {
  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  log(`📍 CEP detectado: ${cep} → ticket ${ticketId}`);
  const result = await calculateFreight(cep);
  if (!result) {
    await sendText(ticketId, 'Não consegui calcular o frete para esse CEP. Um atendente irá confirmar o valor para você. 😊');
    return;
  }
  await sendText(ticketId,
    `🚚 Frete estimado: *R$${result.freight},00*\n📍 Distância: ${result.km} km (${result.region})\n\n_Valor estimado — será confirmado pelo atendente antes da entrega._`
  );
}

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  log(`Webhook recebido: ${JSON.stringify(body).substring(0, 300)}`);
  const product = body?.data?.product || body?.product || 'default';
  const ticketId = body?.ticket?.id || body?.ticketId || body?.data?.ticket?.id;
  if (!ticketId) { log('Webhook sem ticketId, ignorando.'); return; }
  log(`Chatbot trigger: produto=${product}, ticket=${ticketId}`);
  runSequence(String(ticketId), product).catch(err => log(`Erro sequência: ${err.message}`));
});

async function poll() {
  const statuses = ['pending', 'open'];
  for (const status of statuses) {
    const res = await api('get', `/tickets?status=${status}&pageNumber=1`);
    const tickets = res?.tickets || res?.records || [];
    for (const ticket of tickets) {
      const messages = await getTicketMessages(ticket.id);
      for (const msg of messages) {
        if (msg.fromMe) continue;
        if (processedMessages.has(msg.id)) continue;
        const cep = extractCep(msg.body);
        if (cep) await handleCep(ticket.id, msg.id, cep);
      }
    }
  }
}

async function checkReplies() {
  for (const ticketId of activeSequences) {
    const messages = await getTicketMessages(ticketId);
    const hasReply = messages.some(m => {
      if (m.fromMe) return false;
      if (!m.body) return false;
      if (m.body.includes('wa.me/wamo')) return false;
      if (extractCep(m.body)) return false;
      return true;
    });
    if (hasReply) { log(`📨 Lead respondeu → cancelando ticket ${ticketId}`); activeSequences.delete(ticketId); }
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', activeSequences: activeSequences.size, processedMessages: processedMessages.size });
});

app.post('/frete', async (req, res) => {
  const { cep } = req.body;
  if (!cep) return res.status(400).json({ error: 'CEP obrigatório' });
  const result = await calculateFreight(cep);
  if (!result) return res.json({ message: 'CEP inválido ou fora da área de entrega.' });
  return res.json({ km: result.km, region: result.region, freight: result.freight });
});

app.listen(PORT, () => log(`SK Home Worker rodando na porta ${PORT}`));

async function main() {
  log('🚀 SK Home Lead Recovery iniciado');
  log(`📡 Polling CEP a cada ${POLL_INTERVAL_MS / 1000}s`);
  await poll();
  setInterval(async () => { await checkReplies(); await poll(); }, POLL_INTERVAL_MS);
}

main().catch(err => { log(`Erro fatal: ${err.message}`); process.exit(1); });
