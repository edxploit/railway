const axios = require('axios');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const ORIGIN = 'Rua Prates, 809, Bom Retiro, São Paulo, SP, 01121-000, Brazil';

async function calculateFreight(cep) {
  try {
    const dest = `CEP ${cep}, Brazil`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(ORIGIN)}&destinations=${encodeURIComponent(dest)}&key=${GOOGLE_API_KEY}`;
    const res = await axios.get(url, { timeout: 8000 });
    const element = res.data?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;
    const km = Math.round(element.distance.value / 1000);
    const freight = Math.max(50, km * 3);
    return { km, freight };
  } catch (err) {
    return null;
  }
}

module.exports = { calculateFreight };
