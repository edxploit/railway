const axios = require('axios');

const ORIGIN = 'Rua Prates 809, Bom Retiro, São Paulo, SP, Brazil';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Classifica região pelo prefixo do CEP
function getRegionMultiplier(cep) {
  const num = parseInt(cep.replace(/\D/g, '').substring(0, 5));

  // São Paulo capital: 01000-000 a 09999-999
  if (num >= 1000 && num <= 9999999 / 1000) {
    // simplificado: CEPs SP capital começam com 01-09
    const prefix = parseInt(cep.replace(/\D/g, '').substring(0, 2));
    if (prefix >= 1 && prefix <= 9) return { region: 'São Paulo Capital', multiplier: 3 };
  }

  // Litoral: Baixada Santista (11000-11999)
  const prefix3 = parseInt(cep.replace(/\D/g, '').substring(0, 5));
  if (prefix3 >= 11000 && prefix3 <= 11999) return { region: 'Litoral', multiplier: 2 };

  // Interior SP (12000-19999)
  if (prefix3 >= 12000 && prefix3 <= 19999) return { region: 'Interior', multiplier: 2 };

  // Grande SP / outros SP (06000-09999)
  const prefix2 = parseInt(cep.replace(/\D/g, '').substring(0, 2));
  if (prefix2 >= 1 && prefix2 <= 9) return { region: 'São Paulo Capital', multiplier: 3 };
  if (prefix2 >= 6 && prefix2 <= 9) return { region: 'Grande SP', multiplier: 3 };

  return { region: 'São Paulo e Região', multiplier: 3 };
}

async function calculateFreight(destinationCep) {
  const cleanCep = destinationCep.replace(/\D/g, '');
  if (cleanCep.length !== 8) return null;

  const { region, multiplier } = getRegionMultiplier(cleanCep);
  const destination = `${cleanCep}, São Paulo, Brazil`;

  try {
    const res = await axios.post(
      'https://routes.googleapis.com/directions/v2:computeRoutes',
      {
        origin: { address: ORIGIN },
        destination: { address: destination },
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
    const raw = km * multiplier;
    const freight = Math.max(raw, 50);

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
