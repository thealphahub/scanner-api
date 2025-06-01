require('dotenv').config();  
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio'); // <-- Nouveau pour scraper Nitter

const app = express();
const PORT = process.env.PORT || 3001;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '27496bcd-2a62-4e7a-b8f5-0ae44a7d0445';

app.use(cors());

// --- Twitter Engagement Checker (Nitter) ---
async function getTwitterFollowers(handle) {
  if (!handle) return null;
  try {
    const url = `https://nitter.net/${handle.replace('@', '')}`;
    const { data } = await axios.get(url, { timeout: 6000 });
    const $ = cheerio.load(data);
    const followers = $('li:contains("Followers") .profile-stat-num').first().text().replace(/[^\d]/g, '');
    return followers ? parseInt(followers) : null;
  } catch (e) {
    // Peut être "Not found" ou Nitter HS
    return null;
  }
}

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
      if (ext.twitter) socials.twitter = ext.twitter.replace('https://twitter.com/', '').replace('@','');
      if (ext.telegram) socials.telegram = ext.telegram;
      if (ext.discord) socials.discord = ext.discord;
    }
  }
  return socials;
}

// -------- AJOUTE CETTE FONCTION --------
function getField(obj, paths) {
  for (let path of paths) {
    const value = path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
    if (value) return value;
  }
  return null;
}

// -------- NOUVEAU BLOC POUR /scan --------
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

    // NEW: Engagement Twitter
    let twitterFollowers = null;
    let engagementBadge = "No Twitter";
    if (socials.twitter) {
      twitterFollowers = await getTwitterFollowers(socials.twitter);
      if (twitterFollowers === null) engagementBadge = "Compte Twitter introuvable";
      else if (twitterFollowers < 100) engagementBadge = "Low";
      else if (twitterFollowers < 1000) engagementBadge = "Normal";
      else engagementBadge = "Strong";
    }

    // Cherche dans toutes les sources possibles !
    const name = getField(metadata, [
      'name',
      'offChainData.name',
      'offChainData.metadata.name',
      'onChainData.metadata.name'
    ]);
    const symbol = getField(metadata, [
      'symbol',
      'offChainData.symbol',
      'offChainData.metadata.symbol',
      'onChainData.metadata.symbol'
    ]);
    const logo = getField(metadata, [
      'offChainData.image',
      'offChainData.logo',
      'offChainData.metadata.image',
      'offChainData.metadata.logo'
    ]);

    res.json({
      name: name || null,
      symbol: symbol || null,
      logo: logo || null,
      creator: creator || null,
      tokensCreated: tokensCreated.length,
      isHoneypot,
      socials,
      twitterFollowers,
      engagementBadge
    });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Scanner API running on port ${PORT}`);
});
