const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 10000;

async function startWhatsAppSession() {
    const sessionPath = `./auth_info_sion`;
    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: state,
        printQRTerminal: true, // Affiche le QR code dans les logs Render
        logger: pino({ level: 'silent' }),
        browser: ["WaziBot Express", "Chrome", "10.15.0"]
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ WhatsApp connecté avec succès !');
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connexion fermée, reconnexion...', shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppSession();
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Démarrage automatique au lancement du serveur
startWhatsAppSession();

app.get('/', (req, res) => {
    res.send('<h2>WaziBot Express est en ligne. Regardez les logs Render pour scanner le QR Code.</h2>');
});

app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
