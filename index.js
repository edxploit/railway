const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const WHATICKET_URL = process.env.WHATICKET_URL || 'https://app.whaticket.com';
const WHATICKET_TOKEN = process.env.WHATICKET_TOKEN;
const CONNECTION_ID = process.env.CONNECTION_ID || '5511916627971';
const PORT = process.env.PORT || 3000;

// Controle de leads em andamento e já atendidos
const activeLeads = new Set();
const sentLeads = new Set();

const IMAGES = [
  { file: 'beliche-preta.png',           label: 'Beliche Preta' },
  { file: 'beliche-natural-colchao.png', label: 'Beliche Natural' },
  { file: 'beliche-imbuia.png',          label: 'Beliche Imbuia' },
  { file: 'beliche-natural-sem-colchao.png', label: 'Beliche Natural S/ Colchão' },
  { file: 'catalogo.jpg',                label: 'Catálogo' },
];

const FINAL_MESSAGE = 'Qual seu CEP? 📍\nPagamento somente na entrega. ✅';

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sendImage(ticketId, imagePath, label) {
  const form = new FormData();
  form.append('media', fs.createReadStream(imagePath), path.basename(imagePath));

  try {
    await axios.post(
      `${WHATICKET_URL}/api/messages/${ticketId}/media`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${WHATICKET_TOKEN}`,
        },
      }
    );
    log(`Imagem enviada: ${label} → ticket ${ticketId}`);
  } catch (err) {
    log(`Erro ao enviar imagem ${label}: ${err.response?.data?.message || err.message}`);
  }
}

async function sendText(ticketId, text) {
  try {
    await axios.post(
      `${WHATICKET_URL}/api/messages`,
      { ticketId, body: text, fromMe: true },
      { headers: { Authorization: `Bearer ${WHATICKET_TOKEN}` } }
    );
    log(`Mensagem enviada → ticket ${ticketId}`);
  } catch (err) {
    log(`Erro ao enviar mensagem: ${err.response?.data?.message || err.message}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSequence(ticketId, contactId) {
  log(`Iniciando sequência para ticket ${ticketId} / contato ${contactId}`);

  for (let i = 0; i < IMAGES.length; i++) {
    // Cancela se lead respondeu
    if (!activeLeads.has(contactId)) {
      log(`Sequência cancelada (lead respondeu): contato ${contactId}`);
      return;
    }

    const img = IMAGES[i];
    const imgPath = path.join(__dirname, 'images', img.file);

    if (!fs.existsSync(imgPath)) {
      log(`Imagem não encontrada: ${imgPath}`);
    } else {
      await sendImage(ticketId, imgPath, img.label);
    }

    if (i < IMAGES.length - 1) await sleep(2000);
  }

  // Aguarda 3s antes da mensagem final
  await sleep(3000);

  if (!activeLeads.has(contactId)) {
    log(`Sequência cancelada antes da mensagem final: contato ${contactId}`);
    return;
  }

  await sendText(ticketId, FINAL_MESSAGE);
  log(`Sequência concluída para contato ${contactId}`);

  activeLeads.delete(contactId);
  sentLeads.add(contactId);
}

// Webhook principal
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responde rápido

  const event = req.body;
  log(`Evento recebido: ${JSON.stringify(event).substring(0, 200)}`);

  const eventType = event?.event || event?.type;
  const ticket = event?.data?.ticket || event?.ticket;
  const contact = event?.data?.contact || event?.contact;
  const message = event?.data?.message || event?.message;

  // Novo lead entrou (ticket criado)
  if (eventType === 'ticket.created' || eventType === 'ticketCreated') {
    const ticketId = ticket?.id;
    const contactId = contact?.id || ticket?.contactId;

    if (!ticketId || !contactId) {
      log('ticket.created sem ticketId ou contactId, ignorando.');
      return;
    }

    // Proteção: não disparar duas vezes para o mesmo lead
    if (activeLeads.has(contactId) || sentLeads.has(contactId)) {
      log(`Lead ${contactId} já em andamento ou já atendido, ignorando.`);
      return;
    }

    // Proteção: não recuperar conversa já em atendimento
    if (ticket?.status === 'open' && ticket?.userId) {
      log(`Ticket ${ticketId} já tem atendente, ignorando.`);
      return;
    }

    activeLeads.add(contactId);
    log(`Novo lead: contato ${contactId}, ticket ${ticketId}`);

    // Disparo instantâneo
    runSequence(ticketId, contactId);
    return;
  }

  // Lead respondeu — cancela sequência
  if (
    (eventType === 'message.created' || eventType === 'messageCreated') &&
    message?.fromMe === false
  ) {
    const ticketId = ticket?.id || message?.ticketId;
    const contactId = contact?.id || ticket?.contactId;

    if (contactId && activeLeads.has(contactId)) {
      log(`Lead ${contactId} respondeu — cancelando sequência.`);
      activeLeads.delete(contactId);
    }
    return;
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    activeLeads: activeLeads.size,
    sentLeads: sentLeads.size,
  });
});

app.listen(PORT, () => {
  log(`SK Home Webhook rodando na porta ${PORT}`);
});
