require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '27496bcd-2a62-4e7a-b8f5-0ae44a7d0445';

// Permet l’accès depuis ton site (front)
app.use(cors());

async function getTokenMetadata(mint) {
  const url = `https://api.helius.xyz/v0/tokens/metadata?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.post(url, { mintAccounts: [mint] });
  return data && data.length > 0 ? data[0] : null;
}

async function getCreatorWallet(mint) {
  const url = `https://api.helius.xyz/v0/transactions?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.post(url, {
    account: mint,
    limit: 2,
    before: "",
    until: ""
  });
  if (data && data.length > 0) {
    const firstTx = data[data.length - 1];
    return firstTx.signers[0];
  }
  return null;
}

async function getTokensCreatedBy(wallet) {
  const url = `https://api.helius.xyz/v0/addresses/${wallet}/tokens?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.get(url);
  return data.filter(t => t.mint_authority === wallet);
}

async function checkHoneypot(mint) {
  try {
    const url = `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${mint}&amount=10000000`;
    const { data } = await axios.get(url);
    if (data && data.data && data.data.length > 0) {
      return false;
    }
    return true;
  } catch (e) {
    return true;
  }
}

function extractSocials(metadata) {
  const socials = {};
  if (metadata?.offChainData?.extensions) {
    for (const ext of metadata.offChainData.extensions) {
      if (ext.twitter) socials.twitter = ext.twitter;
      if (ext.telegram) socials.telegram = ext.telegram;
      if (ext.discord) socials.discord = ext.discord;
    }
  }
  return socials;
}

// ROUTE PRINCIPALE : /scan?mint=...
app.get('/scan', async (req, res) => {
  const mint = req.query.mint;
  if (!mint) return res.status(400).json({ error: "Missing token mint address" });

  try {
    const metadata = await getTokenMetadata(mint);
    if (!metadata) return res.status(404).json({ error: "Token not found" });

    const creator = await getCreatorWallet(mint);
    let tokensCreated = [];
    if (creator) tokensCreated = await getTokensCreatedBy(creator);
    const isHoneypot = await checkHoneypot(mint);
    const socials = extractSocials(metadata);

    res.json({
      name: metadata.name,
      symbol: metadata.symbol,
      logo: metadata?.offChainData?.image || null,
      creator: creator || null,
      tokensCreated: tokensCreated.length,
      isHoneypot,
      socials
    });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Scanner API running on port ${PORT}`);
});
