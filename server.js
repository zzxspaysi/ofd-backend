// Simple Express server with orders storage and Telegram-based admin auth
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'orders.json');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT);

// In-memory nonces (for simplicity). In production persist them.
const nonces = {}; // { nonce: { createdAt, verified } }

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Helpers
function loadOrders() {
  try {
    if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]');
  } catch (e) { return []; }
}
function saveOrders(arr) { fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2)); }

// Send message via Telegram bot
async function sendTelegram(chat_id, text) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown' })
    });
  } catch (e) {
    console.error('Telegram send error', e);
  }
}

// Create order
app.post('/api/orders', (req, res) => {
  const orders = loadOrders();
  const body = req.body;
  const id = 'srv-' + Date.now();
  const lastNumber = orders.length ? Math.max(...orders.map(o => o.number || 0)) : 1000;
  const number = lastNumber + 1;

  const newOrder = {
    id,
    number,
    userLogin: body.userLogin || null,
    phone: body.phone || null,
    items: body.items || [],
    total: body.total || 0,
    status: 'Ожидает ключа',
    key: null,
    createdAt: new Date().toISOString()
  };

  orders.push(newOrder);
  saveOrders(orders);

  // notify admin via Telegram
  let msg = `🧾 *Новый заказ* №${number}

`;
  msg += `Телефон: ${newOrder.phone}
`;
  if (newOrder.userLogin) msg += `Пользователь: ${newOrder.userLogin}
`;
  msg += `
Товары:
`;
  newOrder.items.forEach(it => msg += `• ${it.title} — ${it.qty} × ${it.price} ₽
`);
  msg += `
💰 Сумма: ${newOrder.total} ₽

`;
  msg += `Админ-панель: ${BASE_URL.replace(/\/$/, '')}/admin.html`;

  sendTelegram(ADMIN_TELEGRAM_ID, msg);

  res.json(newOrder);
});

// notify admin manually
app.post('/api/notify', (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  sendTelegram(ADMIN_TELEGRAM_ID, message);
  res.json({ ok: true });
});

// get orders
app.get('/api/orders', (req, res) => {
  let orders = loadOrders();
  const login = req.query.login;
  const status = req.query.status;

  if (login) orders = orders.filter(o => o.userLogin === login);
  if (status) orders = orders.filter(o => o.status === status);

  res.json(orders);
});

// Admin login request
app.post('/api/admin/request-login', async (req, res) => {
  if (!BOT_TOKEN || !ADMIN_TELEGRAM_ID)
    return res.status(500).json({ error: 'Admin not configured' });

  const nonce = 'n' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  nonces[nonce] = { createdAt: Date.now(), verified: false };

  const verifyLink = `${BASE_URL.replace(/\/$/, '')}/api/admin/verify?nonce=${encodeURIComponent(nonce)}`;
  const text = `Запрос на вход в админ-панел...
