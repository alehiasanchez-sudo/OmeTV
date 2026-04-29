const express = require('express');
const jwt = require('jsonwebtoken');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

const CREATOR_CUT = 0.50;

const GIFTS = [
  { id: 'like',    emoji: '👍', name: 'Like',      cost: 1   },
  { id: 'rose',    emoji: '🌹', name: 'Rosa',      cost: 10  },
  { id: 'heart',   emoji: '❤️', name: 'Corazón',   cost: 25  },
  { id: 'diamond', emoji: '💎', name: 'Diamante',  cost: 100 },
  { id: 'rocket',  emoji: '🚀', name: 'Cohete',    cost: 250 },
  { id: 'crown',   emoji: '👑', name: 'Corona',    cost: 500 }
];

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

router.get('/list', (req, res) => {
  res.json({ gifts: GIFTS });
});

// POST /api/gifts/send
router.post('/send', auth, async (req, res) => {
  try {
    const { toUserId, giftId } = req.body;
    
    console.log('Gift send request:', { toUserId, giftId, fromUser: req.user.userId });
    
    const gift = GIFTS.find(g => g.id === giftId);

    if (!gift)     return res.status(400).json({ error: 'Regalo inválido' });
    if (!toUserId) return res.status(400).json({ error: 'Receptor requerido' });
    if (String(toUserId) === String(req.user.userId))
      return res.status(400).json({ error: 'No puedes enviarte regalos a ti mismo' });

    const creatorAmount  = Math.floor(gift.cost * CREATOR_CUT);
    const platformAmount = gift.cost - creatorAmount;

    // Verificar que el emisor existe y tiene saldo
    const senderCoins = await Coins.findOne({ userId: req.user.userId });
    console.log('Sender coins:', senderCoins);
    
    if (!senderCoins) {
      // Crear documento de monedas si no existe
      await Coins.create({ userId: req.user.userId, balance: 0 });
      return res.status(400).json({ error: 'No tienes monedas' });
    }
    
    if (senderCoins.balance < gift.cost) {
      return res.status(400).json({ error: `Monedas insuficientes. Tienes ${senderCoins.balance} 🪙, necesitas ${gift.cost} 🪙` });
    }

    // ── Descontar del emisor ATÓMICAMENTE ──
    const updatedSender = await Coins.findOneAndUpdate(
      { userId: req.user.userId, balance: { $gte: gift.cost } },
      { $inc: { balance: -gift.cost } },
      { new: true }
    );

    console.log('Updated sender:', updatedSender);

    if (!updatedSender) {
      return res.status(400).json({ error: 'Error al descontar monedas, intenta de nuevo' });
    }

    // ── Acreditar al receptor ATÓMICAMENTE (upsert) ──
    const updatedReceiver = await Coins.findOneAndUpdate(
      { userId: toUserId },
      { $inc: { balance: creatorAmount, totalEarned: creatorAmount } },
      { new: true, upsert: true }
    );

    console.log('Updated receiver:', updatedReceiver);

    // ── Registrar transacciones ──
    try {
      await Transaction.insertMany([
        {
          fromUser: req.user.userId,
          toUser: toUserId,
          type: 'gift_sent',
          amount: gift.cost,
          giftType: giftId
        },
        {
          fromUser: req.user.userId,
          toUser: toUserId,
          type: 'gift_received',
          amount: creatorAmount,
          giftType: giftId
        }
      ]);
    } catch (txErr) {
      console.error('Transaction log error (non-critical):', txErr.message);
    }

    res.json({
      success: true,
      gift,
      senderBalance: updatedSender.balance,
      creatorReceived: creatorAmount,
      platformReceived: platformAmount
    });

  } catch (err) {
    console.error('Gift error full:', err);
    res.status(500).json({ error: 'Error enviando regalo: ' + err.message });
  }
});

module.exports = { router, GIFTS };
