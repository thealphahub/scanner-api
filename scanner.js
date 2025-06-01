require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

app.use(cors());

// --- Récupère les infos Helius ---
async function getTokenMetadata(mint) {
  const url = `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.post(url, { mintAccounts: [mint] });
  console.log('Réponse Helius:', data); // DEBUG dans la console
  return data && data.length > 0 ? data[0] : null;
}

// --- ROUTE SIMPLE ---
app.get('/scan', async (req, res) => {
  const mint = req.query.mint;
  if (!mint) return res.status(400).json({ error: "Missing token mint address" });

  let metadata = null;
  try { metadata = await getTokenMetadata(mint); } catch {}

  // Multi-sources
  const name = metadata?.name || metadata?.offChainData?.name || null;
  const symbol = metadata?.symbol || metadata?.offChainData?.symbol || null;
  const logo = metadata?.offChainData?.image || null;

  if (!metadata) return res.status(404).json({ error: "Token not found" });

  res.json({
    name,
    symbol,
    logo,
    mint
  });
});

app.listen(PORT, () => {
  console.log(`Scanner API running on port ${PORT}`);
});
