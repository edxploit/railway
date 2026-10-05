const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const WHATICKET_URL = process.env.WHATICKET_URL || 'https://app.whaticket.com';
const WHATICKET_TOKEN = process.env.WHATICKET_TOKEN;
const POLL_INTERVAL_MS = 30000; // 30 segundos

// Mapa de IDs de anúncios → produto
const AD_PRODUCT_MAP = {
  '120247380663860452': 'beliche',
  // '120247380663860XXX': 'treliche',
  // '120247380663860YYY': 'cama-bau',
  // '120247380663860ZZZ': 'colchao',
};

// Sequências de imagens por produto
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

// Controle em memória
const processedTickets = new Set(); // tickets já disparados
const activeSequences = new Set();  // sequências em andamento

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function extractAdId(text) {
  if (!text) return null;
  const match = text.match(/preview\/\d+\/(\d+)/);
  return match ? match[1] : null;
}

function getProduct(adId) {
  if (!adId) return 'default';
  return AD_PRODUCT_MAP[adId] || 'default';
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
  if (!fs.existsSync(imgPath)) {
    log(`Imagem não encontrada: ${file}`);
    return;
  }
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
    // Verifica se lead respondeu entre os envios
    if (!activeSequences.has(ticketId)) {
      log(`⏹ Cancelado (lead respondeu) → ticket ${ticketId}`);
      return;
    }
    const img = seq.images[i];
    await sendImage(ticketId, img.file, img.label);
    if (i < seq.images.length - 1) await sleep(2000);
  }

  await sleep(3000);

  if (!activeSequences.has(ticketId)) {
    log(`⏹ Cancelado antes da mensagem final → ticket ${ticketId}`);
    return;
  }

  await sendText(ticketId, seq.message);
  activeSequences.delete(ticketId);
  log(`✅ Concluído → ticket ${ticketId}`);
}

async function poll() {
  log('🔄 Verificando tickets pendentes...');

  // Busca tickets em espera (sem atendente)
  const res = await api('get', '/tickets?status=pending&pageNumber=1');
  const tickets = res?.tickets || res?.records || [];

  if (!tickets.length) {
    log('Nenhum ticket pendente.');
    return;
  }

  log(`${tickets.length} ticket(s) encontrado(s).`);

  for (const ticket of tickets) {
    const ticketId = ticket.id;
    const contactId = ticket.contactId || ticket.contact?.id;

    // Pula se já processado ou em andamento
    if (processedTickets.has(ticketId)) continue;

    // Pula se já tem atendente
    if (ticket.userId) {
      log(`Ticket ${ticketId} já tem atendente, pulando.`);
      continue;
    }

    // Busca mensagens do ticket para detectar o anúncio
    const messages = await getTicketMessages(ticketId);

    // Verifica se já teve resposta do lead após a mensagem inicial
    const leadResponded = messages.some(m => !m.fromMe && m.body && !m.body.includes('wa.me/wamo'));
    if (leadResponded) {
      log(`Ticket ${ticketId} já tem resposta do lead, pulando.`);
      processedTickets.add(ticketId);
      continue;
    }

    // Detecta produto pela primeira mensagem do lead (com link do anúncio)
    const firstMsg = messages.find(m => !m.fromMe);
    const adId = extractAdId(firstMsg?.body);
    const product = getProduct(adId);

    log(`Ticket ${ticketId} | adId: ${adId || 'nenhum'} | produto: ${product}`);

    processedTickets.add(ticketId);

    // Dispara sequência sem bloquear o poll
    runSequence(ticketId, product).catch(err => log(`Erro na sequência: ${err.message}`));

    // Pequena pausa entre tickets para não sobrecarregar a API
    await sleep(1000);
  }
}

// Monitor de respostas — cancela sequências quando lead responde
async function checkReplies() {
  if (!activeSequences.size) return;

  for (const ticketId of activeSequences) {
    const messages = await getTicketMessages(ticketId);
    const hasReply = messages.some(m => !m.fromMe && m.body && !m.body.includes('wa.me/wamo'));
    if (hasReply) {
      log(`📨 Lead respondeu → cancelando sequência ticket ${ticketId}`);
      activeSequences.delete(ticketId);
    }
  }
}

// Health check via HTTP simples
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    processedTickets: processedTickets.size,
    activeSequences: activeSequences.size,
    lastCheck: new Date().toISOString(),
  }));
}).listen(PORT, () => log(`SK Home Worker rodando na porta ${PORT}`));

// Loop principal
async function main() {
  log('🚀 SK Home Lead Recovery iniciado');
  log(`📡 Polling a cada ${POLL_INTERVAL_MS / 1000}s`);

  // Primeira execução imediata
  await poll();

  setInterval(async () => {
    await checkReplies();
    await poll();
  }, POLL_INTERVAL_MS);
}

main().catch(err => {
  log(`Erro fatal: ${err.message}`);
  process.exit(1);
});


// ── Endpoint de cálculo de frete (chamado pelo Wäbot via webhook futuro) ──
const { calculateFreight } = require('./freight');

app.post('/frete', async (req, res) => {
  const { cep } = req.body;
  if (!cep) return res.status(400).json({ error: 'CEP obrigatório' });

  const result = await calculateFreight(cep);
  if (!result) {
    return res.json({
      message: 'Não consegui calcular o frete para esse CEP. Um atendente irá confirmar o valor para você. 😊'
    });
  }

  return res.json({
    message: `🚚 Frete estimado para seu CEP (${result.region}): *R$${result.freight},00*\n📍 Distância: ${result.km} km\n\n_Valor estimado — será confirmado pelo atendente antes da entrega._`
  });
});
