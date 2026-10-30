import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { OpenAI } from 'openai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PHONE_NUMBER = process.env.PHONE_NUMBER; // Format international sans '+' (ex: 2250716017887)

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// System Prompt combiné (Centre SION + ABRAHAM ADOU SARL)
const SYSTEM_PROMPT = `
Tu es l'assistant virtuel intelligent de WaziBot Express, d'ABRAHAM ADOU SARL et de la Mission Mondiale Sion / Centre SION (dirigée par le Prophète Abraham ADOU et la Prophétesse ADOU Grâce).

CONSIGNES :
1. Salue avec bienveillance et bénédiction ("Paix et grâce sur vous au nom de Jésus !").
2. Adresses : Abidjan (derrière la mairie de Songon) et Divo (derrière le collège racine à Buduku, Google Maps : RJVM+7V5).
3. Prières & Écoutes : Les demandes sont portées par le Prophète Abraham ADOU (Ancrages : Marc 6:31, Matthieu 7:7). Écoutes : Mardi au samedi de 09h00 à 16h00. Délivrance : 10h00 à 18h00.
4. Activités Commerciales : Pour WaziBot, les guides pratiques (élevages, pisciculture, import Chine) ou BTP/Immobilier d'ABRAHAM ADOU SARL, recontacte le +225 07 16 01 78 87 ou contact@2asarlglobal.com.
5. Sois court, précis et courtois.
`;

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['WaziBot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    // Demande du code d'appairage si non connecté
    if (!sock.authState.creds.registered) {
        if (PHONE_NUMBER) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(PHONE_NUMBER);
                    console.log(`\n====================================`);
                    console.log(`VOTRE CODE D'APPAIRAGE WHATSAPP : ${code}`);
                    console.log(`====================================\n`);
                } catch (err) {
                    console.error("Erreur génération code d'appairage :", err);
                }
            }, 5000);
        } else {
            console.log("Avertissement: PHONE_NUMBER non configuré dans les variables d'environnement.");
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connexion fermée. Reconnexion...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Connexion WhatsApp établie avec succès !');
        }
    });

    // Gestion des messages entrants
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text;

            if (!textMessage) continue;

            try {
                const response = await openai.chat.completions.create({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: textMessage }
                    ]
                });

                const replyText = response.choices[0].message.content;
                await sock.sendMessage(from, { text: replyText });
            } catch (error) {
                console.error("Erreur réponse OpenAI :", error);
            }
        }
    });
}

// Routes API de contrôle
app.get('/', (req, res) => {
    res.send({ status: 'online', service: 'WaziBot Express' });
});

app.listen(PORT, () => {
    console.log(`Serveur WaziBot en écoute sur le port ${PORT}`);
    connectToWhatsApp();
});
