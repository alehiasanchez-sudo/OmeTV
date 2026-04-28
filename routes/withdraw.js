const express = require('express');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || 'AUfjdwuyzpElyneQJ8PaT4hLVNSzZc-yK4SS7bPQcBFjVumw_s-VlSwDm1X1mng0OCo3OkfTHpeIeGys';
const PAYPAL_SECRET = process.env.PAYPAL_SECRET || 'ELd7AwBHUx09Lm31oNJxIB-77lxOILVFauvG99rjG8fQMZ9gfL3gLKBiEnA5J1iXKW5a_e0Of_p09yCF';
const PAYPAL_BASE = 'https://api-m.paypal.com';

// Tasa: 100 monedas = $0.75
const COINS_TO_USD = 0.0075;
const MIN_WITHDRAW = 133; // mínimo 133 monedas = $1.00

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

// GET /api/withdraw/info — ver balance y tasa
router.get('/info', auth, async (req, res) => {
  try {
    let coins = await Coins.findOne({ userId: req.user.userId });
    const balance = coins?.balance || 0;
    const usdValue = (balance * COINS_TO_USD).toFixed(2);
    res.json({
      balance,
      usdValue,
      minWithdraw: MIN_WITHDRAW,
      minUsd: (MIN_WITHDRAW * COINS_TO_USD).toFixed(2),
      rate: `100 monedas = $${(100 * COINS_TO_USD).toFixed(2)}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/withdraw/request — solicitar retiro automático
router.post('/request', auth, async (req, res) => {
  try {
    const { paypalEmail, coins } = req.body;

    if (!paypalEmail) return res.status(400).json({ error: 'Email de PayPal requerido' });
    if (!coins || coins < MIN_WITHDRAW) {
      return res.status(400).json({ error: `Mínimo ${MIN_WITHDRAW} monedas para retirar` });
    }

    // Verificar balance
    let userCoins = await Coins.findOne({ userId: req.user.userId });
    if (!userCoins || userCoins.balance < coins) {
      return res.status(400).json({ error: 'Monedas insuficientes' });
    }

    const usdAmount = (coins * COINS_TO_USD).toFixed(2);

    // Enviar pago via PayPal Payouts
    const token = await getPayPalToken();
    const payout = await axios.post(`${PAYPAL_BASE}/v1/payments/payouts`, {
      sender_batch_header: {
        sender_batch_id: `trlive_${req.user.userId}_${Date.now()}`,
        email_subject: 'TR-Live - Retiro de monedas',
        email_message: `Has recibido $${usdAmount} USD por tus monedas en TR-Live.`
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: usdAmount, currency: 'USD' },
        receiver: paypalEmail,
        note: `Retiro de ${coins} monedas TR-Live`,
        sender_item_id: `item_${Date.now()}`
      }]
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });

    if (payout.data.batch_header.batch_status === 'PENDING' ||
        payout.data.batch_header.batch_status === 'SUCCESS') {
      // Descontar monedas
      userCoins.balance -= coins;
      await userCoins.save();

      await Transaction.create({
        fromUser: req.user.userId,
        type: 'gift_sent',
        amount: -coins,
        giftType: 'withdrawal'
      });

      res.json({
        success: true,
        coinsDeducted: coins,
        usdSent: usdAmount,
        newBalance: userCoins.balance,
        paypalEmail
      });
    } else {
      res.status(400).json({ error: 'Error procesando el pago' });
    }
  } catch (err) {
    console.error('Withdraw error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Error procesando retiro: ' + (err.response?.data?.message || err.message) });
  }
});

module.exports = router;
