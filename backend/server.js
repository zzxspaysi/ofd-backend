const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DATA_USERS = path.join(__dirname, 'users.json');
const DATA_ORDERS = path.join(__dirname, 'orders.json');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT);

const nonces = {};
function ensureFile(fp, i = '[]') { if (!fs.existsSync(fp)) fs.writeFileSync(fp, i, 'utf8'); }
function loadJSON(fp) { ensureFile(fp); try { return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]'); } catch { return []; } }
function saveJSON(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8'); }
function hashPass(pass) { return crypto.createHash('sha256').update(pass).digest('hex'); }

async function sendTelegram(chat_id, text) {
    if (!BOT_TOKEN) return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" })
        });
    } catch {}
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// AUTH REGISTER
app.post("/api/register", (req, res) => {
    const { name, surname, login, email, pass } = req.body || {};
    if (!name || !surname || !login || !email || !pass)
        return res.status(400).json({ error: "missing fields" });

    if (login.length < 3)
        return res.status(400).json({ error: "login too short" });

    const users = loadJSON(DATA_USERS);

    if (users.find(u => u.login === login))
        return res.status(409).json({ error: "login exists" });

    if (users.find(u => u.email === email))
        return res.status(409).json({ error: "email exists" });

    const user = {
        id: "u" + Date.now(),
        name, surname, login, email,
        passHash: hashPass(pass),
        banned: false,
        createdAt: new Date().toISOString()
    };

    users.push(user);
    saveJSON(DATA_USERS, users);

    const token = jwt.sign({ role: "user", login: user.login, id: user.id }, JWT_SECRET);
    const safeUser = { id: user.id, name, surname, login, email };

    res.json({ token, user: safeUser });
});

// AUTH LOGIN
app.post("/api/login", (req, res) => {
    const { login, pass } = req.body || {};
    const users = loadJSON(DATA_USERS);
    const user = users.find(u => u.login === login);

    if (!user || user.passHash !== hashPass(pass))
        return res.status(401).json({ error: "invalid login" });

    if (user.banned)
        return res.status(403).json({ error: "banned user" });

    const token = jwt.sign({ role: "user", login: user.login, id: user.id }, JWT_SECRET);
    const safeUser = { id: user.id, name: user.name, surname: user.surname, login, email: user.email };
    res.json({ token, user: safeUser });
});

function userAuth(req, res, next) {
    try {
        const token = req.headers.authorization.split(" ")[1];
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { res.status(401).json({ error: "no auth" }); }
}

// CREATE ORDER
app.post("/api/orders", userAuth, (req, res) => {
    const { phone, items, total } = req.body;
    if (!phone || !items?.length) return res.status(400).json({ error: "empty cart" });

    const users = loadJSON(DATA_USERS);
    const user = users.find(u => u.id === req.user.id);
    if (user.banned) return res.status(403).json({ error: "banned" });

    const orders = loadJSON(DATA_ORDERS);
    const order = {
        id: "o" + Date.now(),
        number: (orders.at(-1)?.number || 1000) + 1,
        userLogin: req.user.login,
        phone,
        items,
        total,
        status: "Ожидает ключа",
        key: null,
        createdAt: new Date().toISOString()
    };
    orders.push(order);
    saveJSON(DATA_ORDERS, orders);
    sendTelegram(ADMIN_TELEGRAM_ID, `🧾 Новый заказ №${order.number}\nПользователь: ${order.userLogin}\nСумма: ${order.total} ₽`);
    res.json(order);
});

// GET MY ORDERS
app.get("/api/orders", userAuth, (req, res) =>
    res.json(loadJSON(DATA_ORDERS).filter(o => o.userLogin === req.user.login))
);

// GET PROFILE
app.get("/api/me", userAuth, (req, res) => {
    const users = loadJSON(DATA_USERS);
    const user = users.find(u => u.id === req.user.id);
    res.json(user);
});

// HISTORY
app.get("/api/orders/history", userAuth, (req, res) =>
    res.json(loadJSON(DATA_ORDERS).filter(o => o.userLogin === req.user.login && o.status === "Выполнен"))
);

// KEYS
app.get("/api/user/keys", userAuth, (req, res) =>
    res.json(
        loadJSON(DATA_ORDERS)
            .filter(o => o.userLogin === req.user.login && o.status === "Выполнен" && o.key)
            .map(o => ({
                key: o.key,
                orderNumber: o.number,
                product: o.items.map(i => `${i.title} × ${i.count}`).join(", "),
                createdAt: o.createdAt
            }))
    )
);

// CHANGE PASSWORD
app.post("/api/user/password", userAuth, (req, res) => {
    const { oldPass, newPass } = req.body || {};
    const users = loadJSON(DATA_USERS);
    const user = users.find(u => u.id === req.user.id);
    if (user.passHash !== hashPass(oldPass))
        return res.status(401).json({ error: "wrong password" });
    user.passHash = hashPass(newPass);
    saveJSON(DATA_USERS, users);
    res.json({ ok: true });
});

// ADMIN AUTH — Telegram Login
app.post("/api/admin/request-login", (req, res) => {
    const nonce = "n" + Date.now();
    nonces[nonce] = { createdAt: Date.now(), verified: false };
    sendTelegram(ADMIN_TELEGRAM_ID, `${BASE_URL}/api/admin/verify?nonce=${nonce}`);
    res.json({ ok: true, nonce });
});

app.get("/api/admin/verify", (req, res) => {
    const { nonce } = req.query;
    if (!nonces[nonce]) return res.status(400).send("Invalid");
    nonces[nonce].verified = true;
    res.send("<h2>Вход подтверждён ✔</h2>");
});

app.get("/api/admin/check", (req, res) =>
    res.json({ verified: !!nonces[req.query.nonce]?.verified })
);

app.get("/api/admin/token", (req, res) => {
    const nonce = req.query.nonce;
    if (!nonces[nonce]?.verified)
        return res.status(403).json({ error: "not verified" });
    delete nonces[nonce];
    res.json({ token: jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "6h" }) });
});

function adminAuth(req, res, next) {
    try {
        const payload = jwt.verify(req.headers.authorization.split(" ")[1], JWT_SECRET);
        if (payload.role !== "admin") throw 0;
        next();
    } catch { res.status(403).json({ error: "admin only" }); }
}

// ADMIN: ALL ORDERS
app.get("/api/admin/orders", adminAuth, (req, res) =>
    res.json(loadJSON(DATA_ORDERS))
);

// ADMIN: FULFILL ORDER
app.post("/api/admin/orders/:id/fulfill", adminAuth, (req, res) => {
    const { key } = req.body;
    const orders = loadJSON(DATA_ORDERS);
    const order = orders.find(o => o.id === req.params.id || String(o.number) === req.params.id);
    if (!order) return res.status(404).json({ error: "not found" });
    order.key = key;
    order.status = "Выполнен";
    saveJSON(DATA_ORDERS, orders);
    res.json(order);
});

// ADMIN: USERS LIST
app.get("/api/admin/users", adminAuth, (req, res) => {
    const users = loadJSON(DATA_USERS);
    const orders = loadJSON(DATA_ORDERS);
    res.json(
        users.map(u => ({
            id: u.id,
            login: u.login,
            name: u.name,
            surname: u.surname,
            email: u.email,
            createdAt: u.createdAt,
            banned: u.banned,
            orderCount: orders.filter(o => o.userLogin === u.login).length
        }))
    );
});

// ADMIN: BAN / UNBAN USER
app.post("/api/admin/users/:id/ban", adminAuth, (req, res) => {
    const { id } = req.params;
    const users = loadJSON(DATA_USERS);
    const u = users.find(x => x.id === id);
    u.banned = !u.banned;
    saveJSON(DATA_USERS, users);
    res.json({ banned: u.banned });
});

// ADMIN: RESET PASSWORD
app.post("/api/admin/users/:id/password", adminAuth, (req, res) => {
    const users = loadJSON(DATA_USERS);
    const u = users.find(x => x.id === req.params.id);
    u.passHash = hashPass("1234");
    saveJSON(DATA_USERS, users);
    res.json({ ok: true, newPass: "1234" });
});

// ADMIN: DELETE USER
app.delete("/api/admin/users/:id", adminAuth, (req, res) => {
    let users = loadJSON(DATA_USERS);
    users = users.filter(u => u.id !== req.params.id);
    saveJSON(DATA_USERS, users);
    res.json({ ok: true });
});

app.listen(PORT, () => console.log("Server running on", PORT));
