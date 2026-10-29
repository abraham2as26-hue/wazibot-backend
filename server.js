const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

const PHONE_NUMBER = "+2250716017887";

async function startWhatsAppSession() {
    const sessionPath = `./auth_info_sion`;
    
    if (fs.existsSync(sessionPath)) {
        try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('Ancienne session nettoyée.');
        } catch (err) {
            console.error('Erreur nettoyage:', err);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRTerminal: false
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log("\n==========================================");
                console.log(`🔑 VOTRE CODE D'APPAIRAGE : ${code}`);
                console.log("==========================================\n");
            } catch (err) {
                console.error("Erreur lors de la génération du code d'appairage :", err);
            }
        }, 3000);
    }

    sock.ev.on('connection.update', (update) => {
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

startWhatsAppSession();

app.get('/', (req, res) => {
    res.send('<h2>WaziBot Express - Regardez les logs Render pour le code d\'appairage.</h2>');
});

app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
