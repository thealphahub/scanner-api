require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

app.use(cors());

// ---- Helius functions ----

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
    return {
      address: firstTx.signers ? firstTx.signers[0] : null,
      programId: firstTx.transactionError ? null : firstTx.instructions[0]?.programId || null,
      blockTime: firstTx.blockTime || null
    };
  }
  return null;
}

async function getTokensCreatedBy(wallet) {
  const url = `https://api.helius.xyz/v0/addresses/${wallet}/tokens?api-key=${HELIUS_API_KEY}`;
  const { data } = await axios.get(url);
  return Array.isArray(data) ? data.filter(t => t.mint_authority === wallet) : [];
}

async function checkHoneypot(mint) {
  try {
    // Simule un swap Jupiter de 0.01 SOL -> ce token (s'il fail = honeypot)
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

// Utilitaire pour chercher dans tous les champs possibles
function getField(obj, paths) {
  for (let path of paths) {
    const value = path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function badgeCreator(tokensCreated, txCount, blockTime) {
  // Exemple de badge : "serial minter", "fresh wallet", "clean", "vieux wallet"
  if (!tokensCreated || tokensCreated.length === 0) return "No other tokens";
  if (tokensCreated.length > 10) return "Serial minter";
  if (blockTime && Date.now() / 1000 - blockTime < 86400 * 3) return "Fresh wallet";
  if (txCount < 5) return "Low activity";
  return "Creator clean";
}

// -------- ROUTE PRINCIPALE --------
app.get('/scan', async (req, res) => {
  const mint = req.query.mint;
  if (!mint) return res.status(400).json({ error: "Missing token mint address" });

  try {
    // 1. Metadata
    const metadata = await getTokenMetadata(mint);
    if (!metadata) return res.status(404).json({ error: "Token not found" });

    // 2. Créateur + info du mint
    const creatorInfo = await getCreatorWallet(mint);
    let tokensCreated = [];
    let txCount = 0;
    let creatorBlockTime = null;
    let programId = null;

    if (creatorInfo && creatorInfo.address) {
      tokensCreated = await getTokensCreatedBy(creatorInfo.address);
      creatorBlockTime = creatorInfo.blockTime;
      programId = creatorInfo.programId;
      // Optionnel : compter les tx du wallet créateur (via API ou tx historique)
      // Tu peux étendre ici !
    }

    // 3. Honeypot ?
    const isHoneypot = await checkHoneypot(mint);

    // 4. Socials (optionnel, souvent vide)
    const socials = extractSocials(metadata);

    // 5. Champs
    const name = getField(metadata, [
      'name',
      'offChainData.name',
      'offChainData.metadata.name',
      'onChainData.metadata.name'
    ]) || "-";
    const symbol = getField(metadata, [
      'symbol',
      'offChainData.symbol',
      'offChainData.metadata.symbol',
      'onChainData.metadata.symbol'
    ]) || "-";
    const logo = getField(metadata, [
      'offChainData.image',
      'offChainData.logo',
      'offChainData.metadata.image',
      'offChainData.metadata.logo'
    ]) || null;

    // 6. Badges (exemples)
    const creatorBadge = badgeCreator(tokensCreated, txCount, creatorBlockTime);

    // 7. Programme utilisé pour le mint (ex: Pump.fun, Raydium…)
    let mintPlatform = "Unknown";
    if (programId) {
      if (programId === "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P") mintPlatform = "Pump.fun";
      // Ajoute d'autres programmes ici si tu veux.
    }

    // 8. Sécurité de la metadata
    const metadataIssues = [];
    if (name === "-" || !name) metadataIssues.push("No name");
    if (symbol === "-" || !symbol) metadataIssues.push("No symbol");
    if (!logo) metadataIssues.push("No logo");

    // 9. Score simple
    let securityScore = 100;
    if (isHoneypot) securityScore -= 60;
    if (creatorBadge === "Serial minter") securityScore -= 25;
    if (creatorBadge === "Fresh wallet") securityScore -= 10;
    if (metadataIssues.length > 0) securityScore -= metadataIssues.length * 5;

    // 10. Retour API
    res.json({
      name,
      symbol,
      logo,
      creator: creatorInfo?.address || null,
      tokensCreated: tokensCreated.length,
      isHoneypot,
      socials,
      creatorBadge,
      mintPlatform,
      metadataIssues,
      securityScore
    });

  } catch (e) {
    res.status(500).json({ error: "Server error", details: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Scanner V1 Helius running on port ${PORT}`);
});
