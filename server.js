const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const db = require('./database');
const { startAccountSocket, stopAccountSocket } = require('./whatsappManager');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'your_super_secret_key_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  if (['/login', '/api/login', '/api/signup', '/signup'].includes(req.path)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}
app.use(isAuthenticated);

// ---------- Routes ----------
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>Login</title>
    <style>body{background:#0b141a;color:#e9edef;display:flex;justify-content:center;align-items:center;height:100vh;font-family:Segoe UI;margin:0;}
    .card{background:#1f2c33;padding:40px;border-radius:20px;width:350px;text-align:center;}
    input{width:100%;padding:14px;margin:10px 0;background:#2a3942;border:none;border-radius:10px;color:white;font-size:16px;}
    button{width:100%;padding:14px;background:#00a884;border:none;border-radius:10px;font-weight:bold;font-size:16px;cursor:pointer;}
    a{color:#00a884;}
</style></head><body>
<div class="card"><h1>🔐 Login</h1>
<form action="/api/login" method="POST">
<input type="text" name="username" placeholder="Username" required>
<input type="password" name="password" placeholder="Password" required>
<button type="submit">Login</button>
</form>
<p style="margin-top:20px;">New user? <a href="/signup">Sign up</a></p>
</div></body></html>
  `);
});

app.get('/signup', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>Signup</title>
    <style>body{background:#0b141a;color:#e9edef;display:flex;justify-content:center;align-items:center;height:100vh;font-family:Segoe UI;margin:0;}
    .card{background:#1f2c33;padding:40px;border-radius:20px;width:350px;text-align:center;}
    input{width:100%;padding:14px;margin:10px 0;background:#2a3942;border:none;border-radius:10px;color:white;font-size:16px;}
    button{width:100%;padding:14px;background:#00a884;border:none;border-radius:10px;font-weight:bold;font-size:16px;cursor:pointer;}
    a{color:#00a884;}
</style></head><body>
<div class="card"><h1>📝 Signup</h1>
<form action="/api/signup" method="POST">
<input type="text" name="username" placeholder="Choose Username" required>
<input type="password" name="password" placeholder="Password" required>
<button type="submit">Create Account</button>
</form>
<p style="margin-top:20px;">Already have? <a href="/login">Login</a></p>
</div></body></html>
  `);
});

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('dashboard', { user: req.session.username });
});

// ---------- API ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username);
  if (!user) return res.send('<h3>Invalid User</h3><a href="/login">Go back</a>');
  if (!bcrypt.compareSync(password, user.password)) return res.send('<h3>Wrong Password</h3><a href="/login">Go back</a>');
  req.session.userId = user.id;
  req.session.username = user.username;
  res.redirect('/');
});

app.post('/api/signup', (req, res) => {
  const { username, password } = req.body;
  try {
    db.createUser(username, password);
    res.send('<h3>✅ Account Created! <a href="/login">Login here</a></h3>');
  } catch (e) {
    res.send(`<h3>❌ Username exists! <a href="/signup">Try again</a></h3>`);
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/accounts', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const accounts = db.getAccounts(req.session.userId);
  res.json(accounts);
});

app.post('/api/accounts', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const { phone, reply_message } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const userId = req.session.userId;
  const authFolder = `user_${userId}/acc_${Date.now()}`;
  const result = db.createAccount(userId, phone, authFolder, reply_message || null);
  const accountId = result.lastInsertRowid;

  try {
    const { pairingCode } = await startAccountSocket(accountId);
    return res.json({ success: true, accountId, pairingCode: pairingCode || null });
  } catch (err) {
    db.deleteAccount(accountId);
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/accounts/:id', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const account = db.getAccount(req.params.id);
  if (!account || account.user_id !== req.session.userId) return res.status(403).json({ error: 'Not yours' });

  const { reply_message } = req.body;
  if (reply_message !== undefined) db.updateAccountReply(req.params.id, reply_message);
  res.json({ success: true });
});

app.delete('/api/accounts/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const account = db.getAccount(req.params.id);
  if (!account || account.user_id !== req.session.userId) return res.status(403).json({ error: 'Not yours' });

  await stopAccountSocket(req.params.id);
  db.deleteAccount(req.params.id);
  const folder = path.join(__dirname, 'sessions', account.auth_folder);
  try { fs.rmSync(folder, { recursive: true, force: true }); } catch (e) {}
  res.json({ success: true });
});

app.post('/api/accounts/:id/reconnect', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
  const account = db.getAccount(req.params.id);
  if (!account || account.user_id !== req.session.userId) return res.status(403).json({ error: 'Not yours' });

  await stopAccountSocket(req.params.id);
  const result = await startAccountSocket(req.params.id);
  if (result && result.pairingCode) {
    return res.json({ success: true, pairingCode: result.pairingCode });
  } else {
    return res.json({ success: true });
  }
});

// ---------- Start Server only after DB is ready ----------
db.dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Panel running at http://localhost:${PORT}`);
    if (!fs.existsSync(path.join(__dirname, 'sessions'))) fs.mkdirSync(path.join(__dirname, 'sessions'));
    console.log(`👑 Owner: @anynomuospapa`);
  });
}).catch(err => console.error("❌ Database init failed:", err));
