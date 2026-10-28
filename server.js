const express = require('express');
const cors = require('cors');
const pino = require('pino');
const OpenAI = require('openai');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');

const app = express();

// Middleware CORS et JSON
app.use(cors());
app.use(express.json());

// Initialisation d'OpenAI avec la clé d'environnement Render
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Gestion des clients Baileys
const clients = {};

function getClient(clientId) {
    if (!clients[clientId]) {
        clients[clientId] = {
            id: clientId,
            connected: false,
            qr: null,
            pairingCode: null,
            systemPrompt: "Tu es l'assistant virtuel intelligent de WaziBot Express."
        };
    }
    return clients[clientId];
}

function updatePrompt(clientId, prompt) {
    const client = getClient(clientId);
    client.systemPrompt = prompt;
}

function stopSession(clientId) {
    if (clients[clientId]) {
        clients[clientId].connected = false;
        clients[clientId].qr = null;
        if (clients[clientId].sock) {
            clients[clientId].sock.end();
            clients[clientId].sock = null;
        }
    }
}

// Fonction pour démarrer Baileys, capturer le QR code et écouter les messages
async function startWhatsAppSession(clientId) {
    const client = getClient(clientId);
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${clientId}`);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });
    const phoneNumber = process.env.PHONE_NUMBER;
    if (phoneNumber && !sock.authState.creds.registered && !client.pairingCode) {
        try {
            const cleanedNumber = phoneNumber.replace(/[^0-9]/g, '');
            setTimeout(async () => {
                const code = await sock.requestPairingCode(cleanedNumber);
                client.pairingCode = code;
                console.log(`========================================`);
                console.log(`CODE D'APPAIRAGE POUR ${clientId} : ${code}`);
                console.log(`========================================`);
            }, 3000);
        } catch (err) {
            console.error("Erreur pairing code:", err);
        }
}
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            client.qr = qr;
        }
        if (connection === 'open') {
            client.connected = true;
            client.qr = null;
            console.log(`Client ${clientId} connecté à WhatsApp avec succès !`);
        }
        if (connection === 'close') {
            client.connected = false;
            client.qr = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // ================= ECOUTE ET REPONSE AUTOMATIQUE VIA IA =================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') continue;

            const from = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (!text) continue;

            console.log(`Message reçu de ${from}: ${text}`);

            try {
                const completion = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: client.systemPrompt },
                        { role: 'user', content: text }
                    ],
                    max_tokens: 300
                });

                const reply = completion.choices[0].message.content;
                await sock.sendMessage(from, { text: reply });
                console.log(`Réponse envoyée à ${from}`);

            } catch (error) {
                console.error('Erreur lors de l’appel à l’IA :', error.message);
                await sock.sendMessage(from, {
                    text: "Désolé, je rencontre un souci technique passager. Un conseiller va vous répondre bientôt."
                });
            }
        }
    });

    client.sock = sock;
}

// ================= ROUTES API =================

app.get("/", (req, res) => {
    res.json({ ok: true, service: "wazibot-backend", status: "running" });
});

app.get("/health", (req, res) => res.json({ ok: true, status: "running" }));

app.get("/api/clients/:clientId/status", (req, res) => {
    const { clientId } = req.params;
    const client = getClient(clientId);
    res.json({ ok: true, connected: client.connected });
});

app.get('/api/clients/:clientId/qr', (req, res) => {
    const { clientId } = req.params;
    const client = getClient(clientId);
    if (client && client.qr) {
        res.json({ success: true, qr: client.qr });
    } else {
        res.status(404).json({ success: false, message: "QR code non disponible ou déjà connecté" });
    }
});

app.get("/api/clients/:clientId/pairing-code", (req, res) => {
    const { clientId } = req.params;
    const client = getClient(clientId);
    res.json({
        ok: true,
        pairingCode: client.pairingCode || "1234-5678",
        connected: client.connected
    });
});

app.get('/api/clients/:clientId/connect', async (req, res) => {
    const { clientId } = req.params;
    try {
        await startWhatsAppSession(clientId);
        res.json({ success: true, message: "Génération du QR code démarrée." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post("/api/clients/:clientId/disconnect", (req, res) => {
    const { clientId } = req.params;
    stopSession(clientId);
    res.json({ ok: true });
});

app.get("/api/clients/:clientId/prompt", (req, res) => {
    const { clientId } = req.params;
    const client = getClient(clientId);
    res.json({ ok: true, prompt: client.systemPrompt });
});

app.post("/api/clients/:clientId/prompt", (req, res) => {
    const { clientId } = req.params;
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ ok: false, error: "Prompt invalide" });
    }
    updatePrompt(clientId, prompt);
    const client = getClient(clientId);
    res.json({ ok: true, prompt: client.systemPrompt });
});

app.put("/api/clients/:clientId/catalog", (req, res) => {
    res.json({ ok: true });
});

// Lancement du serveur
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log("WaziBot Express backend lancé sur le port " + PORT);
});
