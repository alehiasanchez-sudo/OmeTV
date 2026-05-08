const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
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
    if (!mongoose.Types.ObjectId.isValid(toUserId))
      return res.status(400).json({ error: 'ID de receptor inválido' });
    if (String(toUserId) === String(req.user.userId))
      return res.status(400).json({ error: 'No puedes enviarte regalos a ti mismo' });

    const receiverId = new mongoose.Types.ObjectId(String(toUserId));
    const senderId   = new mongoose.Types.ObjectId(String(req.user.userId));

    const creatorAmount  = Math.floor(gift.cost * CREATOR_CUT);
    const platformAmount = gift.cost - creatorAmount;

    // ── Descontar del emisor ATÓMICAMENTE (sólo si tiene saldo) ──
    const updatedSender = await Coins.findOneAndUpdate(
      { userId: senderId, balance: { $gte: gift.cost } },
      { $inc: { balance: -gift.cost } },
      { new: true }
    );

    if (!updatedSender) {
      // No tiene saldo suficiente (o no tiene documento de monedas todavía).
      const senderCoins = await Coins.findOne({ userId: senderId });
      const balance = senderCoins?.balance ?? 0;
      return res.status(400).json({
        error: `Monedas insuficientes. Tienes ${balance} 🪙, necesitas ${gift.cost} 🪙`
      });
    }

    console.log(`[gift] sender=${senderId} balance=${updatedSender.balance} (-${gift.cost})`);

    // ── Acreditar al receptor ATÓMICAMENTE (upsert) ──
    let updatedReceiver;
    try {
      updatedReceiver = await Coins.findOneAndUpdate(
        { userId: receiverId },
        { $inc: { balance: creatorAmount, totalEarned: creatorAmount } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    } catch (creditErr) {
      // Si falla la acreditación, REVERTIR el descuento del emisor.
      console.error('[gift] credit failed, refunding sender:', creditErr.message);
      await Coins.updateOne({ userId: senderId }, { $inc: { balance: gift.cost } });
      return res.status(500).json({ error: 'No se pudo acreditar al receptor, monedas devueltas' });
    }

    console.log(`[gift] receiver=${receiverId} balance=${updatedReceiver.balance} (+${creatorAmount})`);

    // ── Registrar transacciones (no crítico) ──
    try {
      await Transaction.insertMany([
        { fromUser: senderId, toUser: receiverId, type: 'gift_sent',     amount: gift.cost,     giftType: giftId },
        { fromUser: senderId, toUser: receiverId, type: 'gift_received', amount: creatorAmount, giftType: giftId }
      ]);
    } catch (txErr) {
      console.error('Transaction log error (non-critical):', txErr.message);
    }

    res.json({
      success: true,
      gift,
      senderBalance: updatedSender.balance,
      receiverBalance: updatedReceiver.balance,
      creatorReceived: creatorAmount,
      platformReceived: platformAmount
    });

  } catch (err) {
    console.error('Gift error full:', err);
    res.status(500).json({ error: 'Error enviando regalo: ' + err.message });
  }
});

module.exports = { router, GIFTS };
