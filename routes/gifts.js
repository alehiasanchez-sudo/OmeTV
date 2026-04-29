const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

const PLATFORM_CUT = 0.50;
const CREATOR_CUT  = 0.50;

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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { toUserId, giftId } = req.body;
    const gift = GIFTS.find(g => g.id === giftId);

    if (!gift)     return res.status(400).json({ error: 'Regalo inválido' });
    if (!toUserId) return res.status(400).json({ error: 'Receptor requerido' });
    if (toUserId === req.user.userId)
      return res.status(400).json({ error: 'No puedes enviarte regalos a ti mismo' });

    const creatorAmount  = Math.floor(gift.cost * CREATOR_CUT);
    const platformAmount = gift.cost - creatorAmount;

    // ── Descontar del emisor de forma ATÓMICA ──
    // Solo descuenta si tiene suficiente balance (balance >= cost)
    const updatedSender = await Coins.findOneAndUpdate(
      { userId: req.user.userId, balance: { $gte: gift.cost } },
      { $inc: { balance: -gift.cost } },
      { new: true, session }
    );

    if (!updatedSender) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ error: 'Monedas insuficientes' });
    }

    // ── Acreditar al receptor de forma ATÓMICA ──
    // upsert: crea el documento si no existe
    const updatedReceiver = await Coins.findOneAndUpdate(
      { userId: toUserId },
      { $inc: { balance: creatorAmount, totalEarned: creatorAmount } },
      { new: true, upsert: true, session }
    );

    // ── Registrar transacciones ──
    await Transaction.create([
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
    ], { session });

    // ── Confirmar transacción ──
    await session.commitTransaction();
    session.endSession();

    res.json({
      success: true,
      gift,
      senderBalance: updatedSender.balance,
      receiverBalance: updatedReceiver.balance,
      creatorReceived: creatorAmount,
      platformReceived: platformAmount
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('Gift error:', err);
    res.status(500).json({ error: 'Error enviando regalo' });
  }
});

module.exports = { router, GIFTS };
