require('dotenv').config();  
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY;
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

app.use(cors());

// --- Fonctions déjà existantes, inchangées ---
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
    return firstTx.signers ? firstTx.signers[0] : null;
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

function getField(obj, paths) {
  for (let path of paths) {
    const value = path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

// --- Birdeye: top holders
async function getTopHoldersBirdeye(mint) {
  if (!BIRDEYE_API_KEY) return null;
  try {
    const url = `https://public-api.birdeye.so/v1/token/holder_list?address=${mint}&limit=10`;
    const { data } = await axios.get(url, {
      headers: {
        "X-API-KEY": BIRDEYE_API_KEY
      }
    });
    return data?.data || null;
  } catch (e) {
    console.log('Birdeye error:', e.response?.status, e.response?.data);
    return null;
  }
}

// --- SOLSCAN: top holders
async function getTopHoldersSolscan(mint) {
  if (!SOLSCAN_API_KEY) return null;
  try {
    const url = `https://api.solscan.io/v2.0/token/holders`;
    const { data } = await axios.post(
      url,
      {
        tokenAddress: mint,
        offset: 0,
        limit: 10
      },
      {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${SOLSCAN_API_KEY}`
        }
      }
    );
    return data?.data || null;
  } catch (e) {
    console.log('Solscan error:', e.response?.status, e.response?.data);
    return null;
  }
}

// ROUTE PRINCIPALE AVEC FAIL-SAFE POUR TOUTES LES API
app.get('/scan', async (req, res) => {
  const mint = req.query.mint;
  if (!mint) return res.status(400).json({ error: "Missing token mint address" });

  let metadata = null, creator = null, tokensCreated = [], isHoneypot = null, socials = {}, topHolders = null, solscanHolders = null;

  // Helius (metadata)
  try { metadata = await getTokenMetadata(mint); } catch (e) { console.log('Helius error:', e.message); }
  // Helius (creator & tokens créés)
  try { creator = await getCreatorWallet(mint); if (creator) tokensCreated = await getTokensCreatedBy(creator); } catch (e) { console.log('Creator error:', e.message); }
  // Honeypot
  try { isHoneypot = await checkHoneypot(mint); } catch (e) { console.log('Honeypot error:', e.message); }
  // Socials
  try { socials = metadata ? extractSocials(metadata) : {}; } catch (e) { console.log('Socials error:', e.message); }
  // Birdeye
  try { topHolders = await getTopHoldersBirdeye(mint); } catch (e) { topHolders = null; }
  // Solscan
  try { solscanHolders = await getTopHoldersSolscan(mint); } catch (e) { solscanHolders = null; }

  // Champs utilitaires
  const name = metadata ? getField(metadata, [
    'name', 'offChainData.name', 'offChainData.metadata.name', 'onChainData.metadata.name'
  ]) : null;
  const symbol = metadata ? getField(metadata, [
    'symbol', 'offChainData.symbol', 'offChainData.metadata.symbol', 'onChainData.metadata.symbol'
  ]) : null;
  const logo = metadata ? getField(metadata, [
    'offChainData.image', 'offChainData.logo', 'offChainData.metadata.image', 'offChainData.metadata.logo'
  ]) : null;

  if (!metadata) return res.status(404).json({ error: "Token not found" });

  res.json({
    name: name || null,
    symbol: symbol || null,
    logo: logo || null,
    creator: creator || null,
    tokensCreated: Array.isArray(tokensCreated) ? tokensCreated.length : 0,
    isHoneypot,
    socials,
    birdeyeTopHolders: topHolders,
    solscanTopHolders: solscanHolders
  });
});

app.listen(PORT, () => {
  console.log(`Scanner API running on port ${PORT}`);
});
