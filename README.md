# SK Home — Webhook

Dispara automaticamente fotos de beliches para leads que chegam pelo WhatsApp via Whaticket.

## Fluxo

1. Lead clica no anúncio e entra no WhatsApp
2. Whaticket cria o ticket e dispara o webhook
3. Railway recebe e envia as 5 fotos em sequência
4. Envia a mensagem final pedindo o CEP
5. Se o lead responder no meio, a sequência é cancelada

## Variáveis de ambiente (Railway)

| Variável | Valor |
|---|---|
| `WHATICKET_URL` | `https://app.whaticket.com` |
| `WHATICKET_TOKEN` | seu token da API |
| `CONNECTION_ID` | `5511916627971` |
| `PORT` | gerado automaticamente pelo Railway |

## Deploy no Railway

1. Crie um novo projeto no [Railway](https://railway.com)
2. Faça upload desta pasta ou conecte via GitHub
3. Adicione as variáveis de ambiente acima
4. Railway vai buildar e subir automaticamente

## Configurar Webhook no Whaticket

1. Vá em **Integrations → Connected apps**
2. Adicione um novo webhook
3. URL: `https://SEU-PROJETO.railway.app/webhook`
4. Eventos: `ticket.created` e `message.created`

## Proteções implementadas

- ✅ Não dispara duas vezes para o mesmo lead
- ✅ Cancela se o lead responder no meio
- ✅ Ignora tickets já em atendimento com agente
- ✅ Log de tudo no console do Railway
