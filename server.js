const express = require('express');
const cors = require('cors');

const app = express();

// Middleware CORS et JSON
app.use(cors());
app.use(express.json());

// Simulation/Gestion des clients Baileys
const clients = {};

function getClient(clientId) {
  if (!clients[clientId]) {
    clients[clientId] = {
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
  }
}

// ==================== ROUTES API ====================

// Route d'accueil & de santé
app.get("/", (req, res) => {
  res.json({ ok: true, service: "wazibot-backend", status: "running" });
});

app.get("/health", (req, res) => res.json({ ok: true, status: "running" }));

// Status de la connexion WhatsApp
app.get("/api/clients/:clientId/status", (req, res) => {
  const { clientId } = req.params;
  const client = getClient(clientId);
  res.json({ ok: true, connected: client.connected });
});

// Route QR Code (Corrige l'erreur 404)
app.get("/api/clients/:clientId/qr", (req, res) => {
  const { clientId } = req.params;
  const client = getClient(clientId);
  res.json({ 
    ok: true, 
    qr: client.qr || null, 
    connected: client.connected 
  });
});

// Route Code d'appairage
app.get("/api/clients/:clientId/pairing-code", (req, res) => {
  const { clientId } = req.params;
  const client = getClient(clientId);
  res.json({ 
    ok: true, 
    pairingCode: client.pairingCode || "1234-5678", 
    connected: client.connected 
  });
});

// Déconnexion
app.post("/api/clients/:clientId/disconnect", (req, res) => {
  const { clientId } = req.params;
  stopSession(clientId);
  res.json({ ok: true });
});

// Lecture du prompt système
app.get("/api/clients/:clientId/prompt", (req, res) => {
  const { clientId } = req.params;
  const client = getClient(clientId);
  res.json({ ok: true, prompt: client.systemPrompt });
});

// Sauvegarde du prompt (PUT & POST)
app.put("/api/clients/:clientId/prompt", (req, res) => {
  const { clientId } = req.params;
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ ok: false, error: "Prompt invalide" });
  updatePrompt(clientId, prompt);
  const client = getClient(clientId);
  res.json({ ok: true, prompt: client.systemPrompt });
});

app.post("/api/clients/:clientId/prompt", (req, res) => {
  const { clientId } = req.params;
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") return res.status(400).json({ ok: false, error: "Prompt invalide" });
  updatePrompt(clientId, prompt);
  const client = getClient(clientId);
  res.json({ ok: true, prompt: client.systemPrompt });
});

// Mise à jour du catalogue
app.put("/api/clients/:clientId/catalog", (req, res) => {
  const { clientId } = req.params;
  const { catalog } = req.body;
  res.json({ ok: true });
});

// Lancement du serveur
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log("WaziBot Express backend lancé sur le port " + PORT);
});
