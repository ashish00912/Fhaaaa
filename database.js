const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const db = new Database(path.join(__dirname, 'panel.db'));

// ---------- Users Table ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ---------- Accounts Table ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    phone TEXT NOT NULL,
    reply_message TEXT DEFAULT '🙏 नमस्ते! यह ऑटोमेटिक रिप्लाई है।',
    auth_folder TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    status TEXT DEFAULT 'disconnected',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// ---------- Helper Functions ----------
function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function createUser(username, password) {
  const hashed = bcrypt.hashSync(password, 10);
  return db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashed);
}

function getAccounts(userId) {
  return db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(userId);
}

function createAccount(userId, phone, authFolder, replyMessage = null) {
  const msg = replyMessage || '🙏 नमस्ते! यह ऑटोमेटिक रिप्लाई है।';
  return db.prepare(`
    INSERT INTO accounts (user_id, phone, auth_folder, reply_message) 
    VALUES (?, ?, ?, ?)
  `).run(userId, phone, authFolder, msg);
}

function updateAccountStatus(accountId, status) {
  return db.prepare('UPDATE accounts SET status = ? WHERE id = ?').run(status, accountId);
}

function updateAccountReply(accountId, message) {
  return db.prepare('UPDATE accounts SET reply_message = ? WHERE id = ?').run(message, accountId);
}

function deleteAccount(accountId) {
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
}

function getAccount(accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
}

module.exports = {
  db,
  getUserByUsername,
  createUser,
  getAccounts,
  createAccount,
  updateAccountStatus,
  updateAccountReply,
  deleteAccount,
  getAccount
};