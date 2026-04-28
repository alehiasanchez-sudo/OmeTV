const express = require('express');
const jwt = require('jsonwebtoken');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

const PLATFORM_CUT = 0.50; // 50% para la plataforma
const CREATOR_CUT = 0.50;  // 50% para el receptor

const GIFTS = [
  { id: 'like',    emoji: '👍', name: 'Like',       cost: 1   },
  { id: 'rose',    emoji: '🌹', name: 'Rosa',      cost: 10  },
  { id: 'heart',   emoji: '❤️', name: 'Corazón',   cost: 25  },
  { id: 'diamond', emoji: '💎', name: 'Diamante',  cost: 100 },
  { id: 'rocket',  emoji: '🚀', name: 'Cohete',    cost: 250 },
  { id: 'crown',   emoji: '👑', name: 'Corona',    cost: 500 }
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

// GET /api/gifts/list
router.get('/list', (req, res) => {
  res.json({ gifts: GIFTS });
});

// POST /api/gifts/send
router.post('/send', auth, async (req, res) => {
  try {
    const { toUserId, giftId } = req.body;
    const gift = GIFTS.find(g => g.id === giftId);

    if (!gift) return res.status(400).json({ error: 'Regalo inválido' });
    if (!toUserId) return res.status(400).json({ error: 'Receptor requerido' });
    if (toUserId === req.user.userId) return res.status(400).json({ error: 'No puedes enviarte regalos a ti mismo' });

    // Verificar balance del emisor
    let senderCoins = await Coins.findOne({ userId: req.user.userId });
    if (!senderCoins || senderCoins.balance < gift.cost) {
      return res.status(400).json({ error: 'Monedas insuficientes' });
    }

    // Calcular corte
    const creatorAmount = Math.floor(gift.cost * CREATOR_CUT);  // 50%
    const platformAmount = gift.cost - creatorAmount;            // 50%

    // Descontar del emisor
    senderCoins.balance -= gift.cost;
    await senderCoins.save();

    // Acreditar al receptor (75%)
    let receiverCoins = await Coins.findOne({ userId: toUserId });
    if (!receiverCoins) receiverCoins = new Coins({ userId: toUserId, balance: 0 });
    receiverCoins.balance += creatorAmount;
    receiverCoins.totalEarned += creatorAmount;
    await receiverCoins.save();

    // Registrar transacciones
    await Transaction.create({
      fromUser: req.user.userId,
      toUser: toUserId,
      type: 'gift_sent',
      amount: gift.cost,
      giftType: giftId
    });

    await Transaction.create({
      fromUser: req.user.userId,
      toUser: toUserId,
      type: 'gift_received',
      amount: creatorAmount,
      giftType: giftId
    });

    res.json({
      success: true,
      gift,
      senderBalance: senderCoins.balance,
      creatorReceived: creatorAmount,
      platformReceived: platformAmount
    });
  } catch (err) {
    console.error('Gift error:', err);
    res.status(500).json({ error: 'Error enviando regalo' });
  }
});

module.exports = { router, GIFTS };
