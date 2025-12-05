// server.js — полный рабочий файл

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

// Admin Telegram login temporary storage
const nonces = {}; // { nonce: { createdAt, verified } }

// -------------------------------------------------
// Helpers
// -------------------------------------------------
function ensureFile(fp, initial = '[]') {
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, initial, 'utf8');
}

function loadJSON(fp) {
    ensureFile(fp);
    try { return JSON.parse(fs.readFileSync(fp, 'utf8') || '[]'); }
    catch { return []; }
}

function saveJSON(fp, data) {
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
}

function hashPass(pass) {
    return crypto.createHash('sha256').update(pass).digest('hex');
}

async function sendTelegram(chat_id, text) {
    if (!BOT_TOKEN) return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id, text, parse_mode: "Markdown" })
        });
    } catch (e) {
        console.error("Telegram error:", e.message);
    }
}

// -------------------------------------------------
// Express app
// -------------------------------------------------
const app = express();
app.use(cors());
app.use(bodyParser.json());

// -------------------------------------------------
// AUTH — Register
// -------------------------------------------------
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
        createdAt: new Date().toISOString()
    };

    users.push(user);
    saveJSON(DATA_USERS, users);

    const token = jwt.sign({ role: "user", login: user.login, id: user.id }, JWT_SECRET);
    const safeUser = { id: user.id, name, surname, login, email };

    res.json({ token, user: safeUser });
});

// -------------------------------------------------
// AUTH — Login
// -------------------------------------------------
app.post("/api/login", (req, res) => {
    const { login, pass } = req.body || {};

    const users = loadJSON(DATA_USERS);
    const user = users.find(u => u.login === login);

    if (!user || user.passHash !== hashPass(pass))
        return res.status(401).json({ error: "invalid login" });

    const token = jwt.sign({ role: "user", login: user.login, id: user.id }, JWT_SECRET);
    const safeUser = { id: user.id, name: user.name, surname: user.surname, login, email: user.email };

    res.json({ token, user: safeUser });
});

// Middleware for user routes
function userAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "no auth" });

    try {
        const token = auth.split(" ")[1];
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: "invalid token" });
    }
}

// -------------------------------------------------
// Create Order (requires user login)
// -------------------------------------------------
app.post("/api/orders", userAuth, (req, res) => {
    const { phone, items, total } = req.body || {};
    if (!Array.isArray(items) || items.length === 0)
        return res.status(400).json({ error: "empty cart" });

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

    sendTelegram(
        ADMIN_TELEGRAM_ID,
        `🧾 Новый заказ №${order.number}\nПользователь: ${order.userLogin}\nСумма: ${order.total} ₽`
    );

    res.json(order);
});

// -------------------------------------------------
// Get My Orders
// -------------------------------------------------
app.get("/api/orders", userAuth, (req, res) => {
    const orders = loadJSON(DATA_ORDERS)
        .filter(o => o.userLogin === req.user.login);
    res.json(orders);
});

// -------------------------------------------------
// ADMIN: Telegram login request
// -------------------------------------------------
app.post("/api/admin/request-login", async (req, res) => {
    const nonce = "n" + Date.now();
    nonces[nonce] = { createdAt: Date.now(), verified: false };

    const link = `${BASE_URL}/api/admin/verify?nonce=${nonce}`;
    sendTelegram(ADMIN_TELEGRAM_ID, `Подтвердите вход:\n${link}`);

    res.json({ ok: true, nonce });
});

app.get("/api/admin/verify", (req, res) => {
    const nonce = req.query.nonce;
    if (!nonces[nonce]) return res.status(400).send("Invalid");
    nonces[nonce].verified = true;

    res.send("<h2>Вход подтвержден ✔</h2>");
});

app.get("/api/admin/check", (req, res) => {
    const nonce = req.query.nonce;
    res.json({ verified: nonces[nonce]?.verified || false });
});

app.get("/api/admin/token", (req, res) => {
    const nonce = req.query.nonce;
    if (!nonces[nonce]?.verified)
        return res.status(403).json({ error: "not verified" });

    delete nonces[nonce];
    const token = jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "6h" });
    res.json({ token });
});

// Middleware for admin
function adminAuth(req, res, next) {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        const payload = jwt.verify(token, JWT_SECRET);
        if (payload.role !== "admin") throw 0;
        req.admin = payload;
        next();
    } catch {
        res.status(403).json({ error: "admin only" });
    }
}

// -------------------------------------------------
// ADMIN: Fulfill Order
// -------------------------------------------------
app.post("/api/orders/:id/fulfill", adminAuth, (req, res) => {
    const id = req.params.id;
    const { key } = req.body;

    const orders = loadJSON(DATA_ORDERS);
    const order = orders.find(o =>
        o.id === id || String(o.number) === String(id)
    );
    if (!order) return res.status(404).json({ error: "not found" });

    order.key = key || order.key;
    order.status = "Выполнен";

    saveJSON(DATA_ORDERS, orders);
    res.json(order);
});

// -------------------------------------------------
app.listen(PORT, () =>
    console.log("Server running on", PORT)
);
