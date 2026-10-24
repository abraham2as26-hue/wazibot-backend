const express = require('express');
const cors = require('cors');
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
let sock = null;
let qrCodeData = null;
let connectionStatus = 'DISCONNECTED';
let systemPrompt = "Tu es l'assistant de vente WaziBot Express. Tu réponds aux clients de façon chaleureuse et professionnelle.";

// Route de vérification de santé (Health Check)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    whatsappStatus: connectionStatus,
    timestamp: new Date().toISOString() 
  });
});

// Route pour récupérer le QR Code ou statut
app.get('/api/qr', async (req, res) => {
  if (connectionStatus === 'CONNECTED') {
    return res.json({ status: 'CONNECTED', message: 'WhatsApp déjà connecté' });
  }
  if (!qrCodeData) {
    return res.json({ status: 'WAITING', message: 'Génération du QR code en cours...' });
  }
  try {
    const qrImageUrl = await QRCode.toDataURL(qrCodeData);
    res.json({ status: 'SCAN_REQUIRED', qrCode: qrImageUrl });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la génération du QR code' });
  }
});

// Route pour configurer / sauvegarder le prompt système
app.post('/api/prompt', (req, res) => {
  const { prompt } = req.body;
  if (prompt) {
    systemPrompt = prompt;
    return res.json({ success: true, message: 'Prompt système mis à jour avec succès' });
  }
  res.status(400).json({ error: 'Prompt invalide' });
});

// Démarrage de la connexion Baileys
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    if (qr) {
      qrCodeData = qr;
      connectionStatus = 'SCAN_REQUIRED';
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      connectionStatus = 'DISCONNECTED';
      qrCodeData = null;
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      connectionStatus = 'CONNECTED';
      qrCodeData = null;
      console.log('✅ Connexion WhatsApp établie avec succès !');
    }
  });

  // Réponse automatique aux messages WhatsApp reçus
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      for (const msg of messages) {
        if (!msg.key.fromMe && msg.message) {
          const from = msg.key.remoteJid;
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
          if (text) {
            console.log(`Message reçu de ${from}: ${text}`);
            await sock.sendMessage(from, { text: `[WaziBot] Merci pour votre message. ${systemPrompt}` });
          }
        }
      }
    }
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Serveur backend en écoute sur le port ${PORT}`);
  connectToWhatsApp();
});
