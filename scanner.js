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

// ROUTE PRINCIPALE
app.get('/scan', async (req, res) => {
  const mint = req.query.mint;
  if (!mint) return res.status(400).json({ error: "Missing token mint address" });

  try {
    const metadata = await getTokenMetadata(mint);
    console.log(metadata); // Pour debug, retire-le si tout fonctionne !

    if (!metadata) return res.status(404).json({ error: "Token not found" });

    const creator = await getCreatorWallet(mint);
    let tokensCreated = [];
    if (creator) tokensCreated = await getTokensCreatedBy(creator);
    const isHoneypot = await checkHoneypot(mint);
    const socials = extractSocials(metadata);

    // Fallback multi-sources
    const name = getField(metadata, [
      'name',
      'offChainData.name',
      'offChainData.metadata.name',
      'onChainData.metadata.name'
    ]) ?? "-";
    const symbol = getField(metadata, [
      'symbol',
      'offChainData.symbol',
      'offChainData.metadata.symbol',
      'onChainData.metadata.symbol'
    ]) ?? "-";
    const logo = getField(metadata, [
      'offChainData.image',
      'offChainData.logo',
      'offChainData.metadata.image',
      'offChainData.metadata.logo'
    ]) || null;

    const topHolders = await getTopHoldersBirdeye(mint);

    res.json({
      name,
      symbol,
      logo,
      creator: creator || null,
      tokensCreated: Array.isArray(tokensCreated) ? tokensCreated.length : 0,
      isHoneypot,
      socials,
      topHolders
    });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Scanner API running on port ${PORT}`);
});
