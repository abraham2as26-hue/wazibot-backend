const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode'); // Utilise le module qrcode déjà installé
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

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
        browser: ["WaziBot Express", "Chrome", "10.15.0"]
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log('--- SCANNEZ CE QR CODE ---');
            // Affiche le QR code en texte brut directement dans les logs Render
            console.log(await QRCode.toString(qr, { type: 'terminal', small: true }));
        }

        if (connection === 'open') {
            console.log('✅ WhatsApp connecté avec succès !');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

startWhatsAppSession();

app.get('/', (req, res) => {
    res.send('<h2>WaziBot Express - Regardez les logs Render pour scanner le QR Code.</h2>');
});

app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
