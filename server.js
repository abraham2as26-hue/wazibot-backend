const express = require('express');
const cors = require('cors');
const pino = require('pino');
const fs = require('fs');
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
            pairingRequested: false,
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
        clients[clientId].pairingRequested = false;
        clients[clientId].pairingCode = null;
        if (clients[clientId].sock) {
            clients[clientId].sock.end();
            clients[clientId].sock = null;
        }
    }
    // Nettoyage complet des anciens fichiers de session
    const sessionPath = `./auth_info_${clientId}`;
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log(`Dossier de session ${sessionPath} nettoyé.`);
    }
}

// Fonction pour démarrer Baileys et gérer la connexion
async function startWhatsAppSession(clientId) {
    stopSession(clientId); // Nettoie avant de recréer une session neuve
    const client = getClient(clientId);
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${clientId}`);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    const phoneNumber = process.env.PHONE_NUMBER;
    if (phoneNumber && !sock.authState.creds.registered && !client.pairingRequested) {
        client.pairingRequested = true;
        try {
            const cleanedNumber = phoneNumber.replace(/[^0-9]/g, '');
            setTimeout(async () => {
                const code = await sock.requestPairingCode(cleanedNumber);
                client.pairingCode = code;
                console.log("========================================");
                console.log(`NOUVEAU CODE D'APPAIRAGE UNIQUE : ${code}`);
                console.log("========================================");
            }, 5000);
        } catch (err) {
            console.error("Erreur pairing code:", err);
            client.pairingRequested = false;
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
            client.pairingRequested = false;
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

// ================= ROUTES API & FRONT-END INTÉGRÉ =================

// Page d'accueil : Interface web SaaS pour les clients
app.get("/", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WaziBot Express - Connexion WhatsApp</title>
    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body class="bg-slate-50 min-h-screen flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <h1 class="text-2xl font-bold text-slate-800 mb-2">WaziBot Express</h1>
        <p class="text-slate-500 text-sm mb-6">Connectez votre WhatsApp pour démarrer votre période d'essai de 7 jours.</p>
        
        <div class="mb-4 text-left">
            <label class="block text-xs font-semibold text-slate-600 uppercase mb-1">Identifiant de votre structure</label>
            <input type="text" id="clientId" value="sion" class="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none text-slate-800 font-medium">
        </div>

        <button id="connectBtn" onclick="startConnection()" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition duration-200 shadow-md cursor-pointer">
            Générer mon QR Code
        </button>

        <div id="qrContainer" class="mt-6 hidden flex flex-col items-center">
            <div id="qrcode" class="p-4 bg-white border border-slate-200 rounded-xl shadow-inner inline-block"></div>
            <p class="text-xs text-slate-500 mt-3 animate-pulse">Scannez ce QR code avec WhatsApp (Appareils liés)</p>
        </div>

        <div id="statusMessage" class="mt-6 text-sm font-medium text-slate-600">
            En attente de démarrage...
        </div>
    </div>

    <script>
        let checkInterval = null;

        async function startConnection() {
            const clientId = document.getElementById('clientId').value.trim();
            const statusDiv = document.getElementById('statusMessage');
            const qrContainer = document.getElementById('qrContainer');
            
            if (!clientId) {
                alert("Veuillez entrer un identifiant valide.");
                return;
            }

            statusDiv.textContent = "Initialisation de la session...";
            qrContainer.classList.add('hidden');

            try {
                const res = await fetch(\`/api/clients/\${clientId}/connect\`);
                const data = await res.json();

                if (data.success) {
                    statusDiv.textContent = "Recherche du QR code en cours...";
                    if (checkInterval) clearInterval(checkInterval);
                    checkInterval = setInterval(() => pollClientStatus(clientId), 3000);
                } else {
                    statusDiv.textContent = "Erreur au démarrage.";
                }
            } catch (err) {
                console.error(err);
                statusDiv.textContent = "Impossible de joindre le serveur.";
            }
        }

        async function pollClientStatus(clientId) {
            const statusDiv = document.getElementById('statusMessage');
            const qrContainer = document.getElementById('qrContainer');

            try {
                const statusRes = await fetch(\`/api/clients/\${clientId}/status\`);
                const statusData = await statusRes.json();

                if (statusData.connected) {
                    clearInterval(checkInterval);
                    qrContainer.classList.add('hidden');
                    statusDiv.innerHTML = "<span class='text-green-600 font-bold'>✓ WhatsApp connecté avec succès ! Bot actif.</span>";
                    return;
                }

                const qrRes = await fetch(\`/api/clients/\${clientId}/qr\`);
                const qrData = await qrRes.json();

                if (qrData.success && qrData.qr) {
                    qrContainer.classList.remove('hidden');
                    statusDiv.textContent = "Scannez le QR code ci-dessous :";
                    
                    const qrElement = document.getElementById('qrcode');
                    qrElement.innerHTML = "";
                    new QRCode(qrElement, {
                        text: qrData.qr,
                        width: 220,
                        height: 220
                    });
                }
            } catch (err) {
                console.error("Erreur lors du polling :", err);
            }
        }
    </script>
</body>
</html>`);
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
        pairingCode: client.pairingCode || "En attente...",
        connected: client.connected
    });
});

app.get('/api/clients/:clientId/connect', async (req, res) => {
    const { clientId } = req.params;
    try {
        await startWhatsAppSession(clientId);
        res.json({ success: true, message: "Session réinitialisée et génération du code démarrée." });
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
