const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = path.join(__dirname, 'panel.db');
let db;

function initDB() {
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new initSqlJs.Database(buffer);
  } else {
    db = new initSqlJs.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
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
  saveDB();
}

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function getUserByUsername(username) {
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  const result = stmt.get(username);
  stmt.free();
  return result;
}

function createUser(username, password) {
  const hashed = bcrypt.hashSync(password, 10);
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashed]);
  saveDB();
  return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0].values[0][0] };
}

function getAccounts(userId) {
  const stmt = db.prepare('SELECT * FROM accounts WHERE user_id = ?');
  const rows = stmt.all(userId);
  stmt.free();
  return rows;
}

function createAccount(userId, phone, authFolder, replyMessage = null) {
  const msg = replyMessage || '🙏 नमस्ते! यह ऑटोमेटिक रिप्लाई है।';
  db.run(
    'INSERT INTO accounts (user_id, phone, auth_folder, reply_message) VALUES (?, ?, ?, ?)',
    [userId, phone, authFolder, msg]
  );
  saveDB();
  return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0].values[0][0] };
}

function updateAccountStatus(accountId, status) {
  db.run('UPDATE accounts SET status = ? WHERE id = ?', [status, accountId]);
  saveDB();
}

function updateAccountReply(accountId, message) {
  db.run('UPDATE accounts SET reply_message = ? WHERE id = ?', [message, accountId]);
  saveDB();
}

function deleteAccount(accountId) {
  db.run('DELETE FROM accounts WHERE id = ?', [accountId]);
  saveDB();
}

function getAccount(accountId) {
  const stmt = db.prepare('SELECT * FROM accounts WHERE id = ?');
  const result = stmt.get(accountId);
  stmt.free();
  return result;
}

initSqlJs().then(SQL => {
  initDB();
}).catch(console.error);

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
