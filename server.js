const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal'); // Utilisation explicite pour forcer l'affichage
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

    // Affichage propre et direct du QR Code via qrcode-terminal
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log('--- SCANNEZ CE QR CODE ---');
            qrcode.generate(qr, { small: true });
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
