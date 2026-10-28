const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

// Gestionnaire des sessions actives
const sessions = {};

function getClient(clientId) {
    if (!sessions[clientId]) {
        sessions[clientId] = {
            sock: null,
            qr: null,
            connected: false
        };
    }
    return sessions[clientId];
}

function stopsession(clientId) {
    if (sessions[clientId] && sessions[clientId].sock) {
        try {
            sessions[clientId].sock.end(undefined);
        } catch (e) {
            console.error(e);
        }
        sessions[clientId].sock = null;
    }
}

async function startWhatsAppSession(clientId) {
    stopsession(clientId);
    const client = getClient(clientId);
    const { state, saveCreds } = await useMultiFileAuthState(`./auth_info_${clientId}`);

    const sock = makeWASocket({
        auth: state,
        printQRTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["WaziBot Express", "Chrome", "10.15.0"],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        retryRequestDelayMs: 2500
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            client.qr = qr;
        }
        if (connection === 'open') {
            client.connected = true;
            client.qr = null;
            console.log(`Client ${clientId} connecté avec succès !`);
        }
        if (connection === 'close') {
            client.connected = false;
            client.qr = null;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connexion fermée pour ${clientId}, reconnexion :`, shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppSession(clientId);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Test temporaire de réception / réponse automatique
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            const from = msg.key.remoteJid;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            if (!text) continue;
            try {
                const reply = `✅ Test réussi ! Ton message a bien été reçu : "${text}"`;
                await sock.sendMessage(from, { text: reply });
            } catch (error) {
                console.error('Erreur lors de l\'envoi du message test :', error);
            }
        }
    });

    client.sock = sock;
}

// Interface Web simple pour afficher et générer le QR Code
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="fr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WaziBot Express</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f7f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; width: 350px; }
                input { width: 100%; padding: 10px; margin: 15px 0; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
                button { background: #6366f1; color: white; border: none; padding: 12px; width: 100%; border-radius: 6px; cursor: pointer; font-size: 16px; }
                button:hover { background: #4f46e5; }
                #qrcode { margin-top: 20px; display: flex; justify-content: center; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>WaziBot Express</h2>
                <p>Connectez votre WhatsApp pour démarrer.</p>
                <input type="text" id="clientId" value="sion" placeholder="Identifiant de structure">
                <button onclick="generateQR()">Générer mon QR Code</button>
                <div id="status">En attente de démarrage...</div>
                <div id="qrcode"></div>
            </div>
            <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js"></script>
            <script>
                async function generateQR() {
                    const clientId = document.getElementById('clientId').value;
                    document.getElementById('status').innerText = 'Génération en cours...';
                    
                    await fetch('/start?clientId=' + clientId);
                    
                    const interval = setInterval(async () => {
                        const res = await fetch('/status?clientId=' + clientId);
                        const data = await res.json();
                        if (data.connected) {
                            document.getElementById('status').innerText = '✅ Connecté avec succès !';
                            document.getElementById('qrcode').innerHTML = '';
                            clearInterval(interval);
                        } else if (data.qr) {
                            document.getElementById('status').innerText = 'Scannez ce QR Code :';
                            document.getElementById('qrcode').innerHTML = '<canvas id="canvas"></canvas>';
                            QRCode.toCanvas(document.getElementById('canvas'), data.qr, function (error) {
                                if (error) console.error(error);
                            });
                        }
                    }, 3000);
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/start', async (req, res) => {
    const q = req.query.clientId;
    const clientId = q || 'sion';
    startWhatsAppSession(clientId);
    res.json({ 
        success: true, 
        message: 'Session démarrée' 
    });
});

app.get('/status', (req, res) => {
    const q = req.query.clientId;
    const clientId = q || 'sion';
    const client = sessions[clientId];
    if (!client) {
        return res.json({ 
            connected: false, 
            qr: null 
        });
    }
    res.json({ 
        connected: client.connected, 
        qr: client.qr 
    });
});

app.listen(PORT, () => {
    console.log(`WaziBot Express backend lancé sur le port ${PORT}`);
});
