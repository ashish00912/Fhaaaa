const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const activeSockets = {};

async function startAccountSocket(accountId) {
  const account = db.getAccount(accountId);
  if (!account) return;

  const authFolder = path.join(__dirname, 'sessions', `user_${account.user_id}`, `acc_${accountId}`);
  
  if (activeSockets[accountId]) {
    try { await activeSockets[accountId].ws?.close(); } catch (e) {}
    delete activeSockets[accountId];
  }

  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: 'silent' }),
    browser: ['Chrome (Linux)', '', ''],
  });

  let pairingCode = null;

  if (!state.creds.registered) {
    try {
      pairingCode = await sock.requestPairingCode(account.phone);
      console.log(`📲 [${accountId}] Pairing Code: ${pairingCode}`);
    } catch (err) {
      console.error(`❌ [${accountId}] Code Error: ${err.message}`);
      db.updateAccountStatus(accountId, 'error');
      return;
    }
  } else {
    console.log(`♻️ [${accountId}] Session restored.`);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      db.updateAccountStatus(accountId, 'connected');
      console.log(`🟢 [${accountId}] Online.`);
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      db.updateAccountStatus(accountId, 'disconnected');
      delete activeSockets[accountId];
      if (shouldReconnect) {
        console.log(`🔄 [${accountId}] Reconnecting in 5s...`);
        setTimeout(() => startAccountSocket(accountId), 5000);
      } else {
        console.log(`🚫 [${accountId}] Logged out.`);
        try { fs.rmSync(authFolder, { recursive: true, force: true }); } catch (e) {}
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    const messages = m.messages;
    if (!messages || messages.length === 0) return;

    const freshAccount = db.getAccount(accountId);
    const replyText = freshAccount?.reply_message || '🙏 नमस्ते!';

    const processMessage = async (msg) => {
      if (!msg.message) return;
      if (msg.key.fromMe) return;
      if (msg.key.remoteJid === 'status@broadcast') return;
      const sender = msg.key.remoteJid;
      try {
        await sock.sendMessage(sender, { text: replyText });
        console.log(`📩 [${accountId}] Replied to ${sender}`);
      } catch (err) {
        console.error(`❌ [${accountId}] Reply fail: ${err.message}`);
      }
    };

    const BATCH_SIZE = 5;
    const DELAY_MS = 200;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(processMessage));
      if (i + BATCH_SIZE < messages.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }
    console.log(`✅ [${accountId}] ${messages.length} messages replied.`);
  });

  activeSockets[accountId] = sock;
  return { sock, pairingCode };
}

async function stopAccountSocket(accountId) {
  if (activeSockets[accountId]) {
    try { await activeSockets[accountId].ws?.close(); } catch (e) {}
    delete activeSockets[accountId];
    db.updateAccountStatus(accountId, 'disconnected');
    return true;
  }
  return false;
}

function getSocket(accountId) {
  return activeSockets[accountId] || null;
}

module.exports = {
  startAccountSocket,
  stopAccountSocket,
  getSocket,
  activeSockets
};
