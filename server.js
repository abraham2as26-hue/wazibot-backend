const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 10000;

async function startWhatsAppSession() {
    const sessionPath = `./auth_info_sion`;
    
    // Nettoyage radical de l'ancienne session à chaque démarrage
    if (fs.existsSync(sessionPath)) {
        try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            console.log('Ancienne session supprimée avec succès.');
        } catch (err) {
            console.error('Erreur suppression session:', err);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const sock = makeWASocket({
        auth: state,
        printQRTerminal: true, // Force l'affichage du QR code dans les logs Render
        logger: pino({ level: 'silent' }),
        browser: ["WaziBot Express", "Chrome", "10.15.0"]
    });

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') {
            console.log('✅ WhatsApp connecté avec succès !');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Lancement unique au démarrage du serveur
startWhatsAppSession();

app.get('/', (req, res) => {
    res.send('<h2>WaziBot Express - Regardez les logs Render pour scanner le QR Code.</h2>');
});

app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
