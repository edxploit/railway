const axios = require('axios');

const ORIGIN = 'Rua Prates 809, Bom Retiro, São Paulo, SP, Brazil';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

function getRegionMultiplier(cep) {
  const num = parseInt(cep.replace(/\D/g, '').substring(0, 5));

  if (num >= 11000 && num <= 11999) return { region: 'Litoral', multiplier: 2 };
  if (num >= 12000 && num <= 19999) return { region: 'Interior', multiplier: 2 };

  const prefix2 = parseInt(cep.replace(/\D/g, '').substring(0, 2));
  if (prefix2 >= 1 && prefix2 <= 9) return { region: 'São Paulo Capital', multiplier: 3 };

  return { region: 'São Paulo e Região', multiplier: 3 };
}

async function calculateFreight(destinationCep) {
  const cleanCep = destinationCep.replace(/\D/g, '');
  if (cleanCep.length !== 8) return null;

  const { region, multiplier } = getRegionMultiplier(cleanCep);

  try {
    const res = await axios.post(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        origin: { address: ORIGIN },
        destination: { address: `${cleanCep}, São Paulo, Brazil` },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        timeout: 10000,
      }
    );

    const meters = res.data?.routes?.[0]?.distanceMeters;
    if (!meters) return null;

    const km = meters / 1000;
    const freight = Math.max(km * multiplier, 50);

    return {
      km: km.toFixed(1),
      region,
      multiplier,
      freight: Math.round(freight),
    };
  } catch (err) {
    console.error('Erro Google Routes:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { calculateFreight };
