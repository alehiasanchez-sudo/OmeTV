const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'AUfjdwuyzpElyneQJ8PaT4hLVNSzZc-yK4SS7bPQcBFjVumw_s-VlSwDm1X1mng0OCo3OkfTHpeIeGys';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || 'ELd7AwBHUx09Lm31oNJxIB-77lxOILVFauvG99rjG8fQMZ9gfL3gLKBiEnA5J1iXKW5a_e0Of_p09yCF';
const PAYPAL_BASE = 'https://api-m.sandbox.paypal.com'; // cambiar a api-m.paypal.com en producción

// Paquetes de monedas
const COIN_PACKAGES = [
  { id: 'pack_100', coins: 100, price: '1.00', label: '100 monedas' },
  { id: 'pack_500', coins: 500, price: '4.50', label: '500 monedas' },
  { id: 'pack_1000', coins: 1000, price: '8.00', label: '1000 monedas' },
  { id: 'pack_2500', coins: 2500, price: '18.00', label: '2500 monedas' }
];

// Regalos disponibles
const GIFTS = [
  { id: 'rose', emoji: '🌹', name: 'Rosa', cost: 10 },
  { id: 'heart', emoji: '❤️', name: 'Corazón', cost: 25 },
  { id: 'diamond', emoji: '💎', name: 'Diamante', cost: 100 },
  { id: 'rocket', emoji: '🚀', name: 'Cohete', cost: 250 },
  { id: 'crown', emoji: '👑', name: 'Corona', cost: 500 }
];

// Auth middleware
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Obtener token de PayPal
async function getPayPalToken() {
  const res = await axios.post(`${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      auth: { username: PAYPAL_CLIENT_ID, password: PAYPAL_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  return res.data.access_token;
}

// GET /api/coins/packages
router.get('/packages', (req, res) => {
  res.json({ packages: COIN_PACKAGES, gifts: GIFTS });
});

// GET /api/coins/balance
router.get('/balance', auth, async (req, res) => {
  try {
    let coins = await Coins.findOne({ userId: req.user.userId });
    if (!coins) coins = await Coins.create({ userId: req.user.userId, balance: 0 });
    res.json({ balance: coins.balance });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/coins/create-order — crear orden PayPal
router.post('/create-order', auth, async (req, res) => {
  try {
    const { packageId } = req.body;
    const pkg = COIN_PACKAGES.find(p => p.id === packageId);
    if (!pkg) return res.status(400).json({ error: 'Paquete inválido' });

    const token = await getPayPalToken();
    const order = await axios.post(`${PAYPAL_BASE}/v2/checkout/orders`, {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: 'USD', value: pkg.price },
        description: `TR-Live - ${pkg.label}`
      }]
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    res.json({ orderId: order.data.id, packageId });
  } catch (err) {
    console.error('PayPal error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error creando orden' });
  }
});

// POST /api/coins/capture-order — capturar pago y acreditar monedas
router.post('/capture-order', auth, async (req, res) => {
  try {
    const { orderId, packageId } = req.body;
    const pkg = COIN_PACKAGES.find(p => p.id === packageId);
    if (!pkg) return res.status(400).json({ error: 'Paquete inválido' });

    const token = await getPayPalToken();
    const capture = await axios.post(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {}, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    if (capture.data.status === 'COMPLETED') {
      // Acreditar monedas
      let coins = await Coins.findOne({ userId: req.user.userId });
      if (!coins) coins = new Coins({ userId: req.user.userId, balance: 0 });
      coins.balance += pkg.coins;
      coins.totalEarned += pkg.coins;
      await coins.save();

      await Transaction.create({
        fromUser: req.user.userId,
        type: 'purchase',
        amount: pkg.coins,
        paypalOrderId: orderId
      });

      res.json({ success: true, balance: coins.balance, coinsAdded: pkg.coins });
    } else {
      res.status(400).json({ error: 'Pago no completado' });
    }
  } catch (err) {
    console.error('Capture error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error capturando pago' });
  }
});

module.exports = { router, GIFTS };
