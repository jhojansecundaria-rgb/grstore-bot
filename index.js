require('dotenv').config();
const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const chats = {};

const CATALOGO = `
CAMISETAS:
- Camiseta Adidas Original Lima: $115.000
- Camiseta Puma Couture Negra: $120.000
- Camiseta Nike Pro Running Negra: $130.000
- Camiseta Nike Sportswear Lavanda: $115.000
- Camiseta Nike Couture Blanca: $120.000
- Camiseta Karl Lagerfeld Logo Beige: $165.000
- Camiseta Nike Just Do It Crema: $120.000
- Camiseta Nike Henley Jersey Gris: $125.000
- Camiseta Nike Just Do It Verde Menta: $125.000
- Camiseta Nike Air Box Logo Morada: $120.000
- Camiseta Fear of God Essentials Beige: $185.000

POLOS:
- Polo Adidas Azul Claro: $135.000
- Polo Adidas Patron Negro/Gris: $140.000
- Polo Oakley Onda Blanco/Teal: $145.000
- Polo Nike Dri-FIT Punteado Negro: $140.000
- Polo Adidas Herringbone Rosa/Gris: $140.000
- Polo Nike Dri-FIT Punteado Gris: $140.000
- Polo Nike Dri-FIT Coral Patron: $140.000
- Polo Moschino Teddy Bear Negro: $195.000

HOODIES:
- Sudadera Quiksilver Capucha Negra: $175.000
- Buzo Nike Medio Cierre Verde: $180.000

CONJUNTOS:
- Conjunto Adidas Hoodie Gris: $235.000
- Conjunto Adidas Track Verde: $240.000

TENIS:
- Tenis Nike Air Max Plus TN Beige: $420.000
- Tenis Nike Dunk Low Floral Fuego: $450.000
`;

const SYSTEM_PROMPT = `Eres el asistente virtual de GR Store, tienda de ropa deportiva original importada de USA.
Tu trabajo es atender clientes por WhatsApp y registrar pedidos.

CATALOGO DISPONIBLE:
${CATALOGO}

FLUJO OBLIGATORIO:
1. Saluda mencionando GR Store y pregunta el nombre del cliente
2. Pregunta que tipo de prenda busca o si quiere ver todo el catalogo
3. Muestra las opciones de esa categoria con precios
4. Cuando elija pregunta la talla (XS/S/M/L/XL/XXL)
5. Muestra el resumen completo y pide confirmacion
6. Si confirma responde EXACTAMENTE asi sin escribir nada mas:

PEDIDO_LISTO
Nombre: [nombre del cliente]
Producto: [nombre exacto del producto]
Talla: [talla elegida]
Precio: [precio del producto]
Telefono: [numero del cliente]

REGLAS:
- Solo ofrece productos que esten en el catalogo
- Nunca inventes productos ni precios
- Si el cliente cancela responde unicamente: PEDIDO_CANCELADO
- Habla siempre en espanol colombiano
- Se amable y usa pocos emojis
- Si preguntan por envio di que un asesor confirmara el costo segun la ciudad`;

async function responder(numero, mensaje) {
  if (!chats[numero]) {
    chats[numero] = [];
  }

  chats[numero].push({ role: 'user', content: mensaje });

  const resultado = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: chats[numero],
  });

  const texto = resultado.content[0].text;
  chats[numero].push({ role: 'assistant', content: texto });

  if (texto.includes('PEDIDO_LISTO')) {
    await notificarme(texto, numero);
    delete chats[numero];
    return '✅ Pedido registrado. Un asesor de GR Store te contactara pronto para coordinar pago y envio. Gracias!';
  }

  if (texto.includes('PEDIDO_CANCELADO')) {
    delete chats[numero];
    return 'Pedido cancelado. Cuando quieras volver a pedir escribenos. Hasta pronto!';
  }

  return texto;
}

async function notificarme(texto, numeroCliente) {
  const inicio = texto.indexOf('PEDIDO_LISTO');
  const resumen = texto.slice(inicio).replace('PEDIDO_LISTO', '').trim();
  const hora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const msg = `🛍️ *NUEVO PEDIDO - GR Store*\n\n${resumen}\n\n🕐 ${hora}`;
  await enviar(process.env.MI_NUMERO, msg);
}

async function enviar(numero, texto) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: numero,
      type: 'text',
      text: { body: texto },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

app.get('/ping', (req, res) => {
  res.send('ok');
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verificado OK');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || !msg.text || !msg.text.body) return;
    const numero = msg.from;
    const texto = msg.text.body;
    console.log('Mensaje de ' + numero + ': ' + texto);
    const respuesta = await responder(numero, texto);
    await enviar(numero, respuesta);
    console.log('Respuesta enviada OK');
  } catch (error) {
    console.error('Error: ' + error.message);
  }
});

// Keep alive 24/7
const https = require('https');
setInterval(() => {
  https.get('https://grstore-bot-production.up.railway.app/ping', () => {
    console.log('Keep-alive OK');
  }).on('error', (e) => {
    console.error('Keep-alive error: ' + e.message);
  });
}, 14 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('GR Store Bot corriendo en puerto ' + PORT);
});