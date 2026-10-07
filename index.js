const express = require('express');
const axios = require('axios');
const { calculateFreight } = require('./freight');

const app = express();
app.use(express.json());

const WHATICKET_URL = process.env.WHATICKET_URL || 'https://app.whaticket.com';
const WHATICKET_TOKEN = process.env.WHATICKET_TOKEN;
const PORT = process.env.PORT || 3000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function extractCep(text) {
  if (!text) return null;
  const match = text.match(/\b(\d{5})-?(\d{3})\b/);
  return match ? `${match[1]}${match[2]}` : null;
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
    log(`API erro [${endpoint}]: ${err.response?.status} ${err.response?.data?.message || err.message}`);
    return null;
  }
}

async function sendText(ticketId, text) {
  const res = await api('post', `/v1/tickets/${ticketId}/messages`, { body: text });
  if (res) log(`✓ Texto enviado → ticket ${ticketId}`);
}

const processedMessages = new Set();

app.post('/cep', async (req, res) => {
  res.sendStatus(200);
  const { ticketId, message } = req.body;
  if (!ticketId || !message) return;

  const msgId = `${ticketId}-${message}`;
  if (processedMessages.has(msgId)) return;
  processedMessages.add(msgId);

  log(`CEP recebido: "${message}" ticket ${ticketId}`);
  const cep = extractCep(message);
  if (!cep) {
    await sendText(ticketId, 'CEP inválido. Pode me enviar novamente? Ex: 01310-100');
    return;
  }

  await sendText(ticketId, '⏳ Calculando frete...');
  const result = await calculateFreight(cep);

  if (!result) {
    await sendText(ticketId, 'Não consegui calcular o frete para esse CEP. Nossa atendente vai confirmar o valor para você. 😊');
    return;
  }

  await sendText(ticketId,
    `🚚 Frete estimado: *R$${result.freight},00*\n📍 Distância: ${result.km} km\n\n_Valor confirmado pela atendente antes da entrega._`
  );
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'SK Home Frete' });
});

app.listen(PORT, () => log(`SK Home rodando na porta ${PORT}`));
