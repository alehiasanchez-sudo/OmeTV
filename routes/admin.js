const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

// ── Middleware: requiere admin ──
const requireAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verificar role en DB (no confiar sólo en JWT por si fue degradado).
    const user = await User.findById(decoded.userId).select('role banned');
    if (!user || user.banned) return res.status(403).json({ error: 'Acceso denegado' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Se requieren permisos de administrador' });
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// ── USUARIOS ──

// GET /api/admin/users?search=foo&page=1&limit=50
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 50 } = req.query;
    const filter = search
      ? { username: { $regex: search, $options: 'i' } }
      : {};
    const users = await User.find(filter)
      .select('username age gender country banned role createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    // Adjuntar balance de monedas
    const ids = users.map(u => u._id);
    const coins = await Coins.find({ userId: { $in: ids } }).lean();
    const coinsMap = {};
    coins.forEach(c => { coinsMap[String(c.userId)] = c.balance; });

    const total = await User.countDocuments(filter);
    res.json({
      users: users.map(u => ({ ...u, balance: coinsMap[String(u._id)] || 0 })),
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (err) {
    console.error('admin/users:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { banned: true }, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true, user: { id: user._id, banned: user.banned } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { banned: false }, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true, user: { id: user._id, banned: user.banned } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/promote
router.post('/users/:id/promote', requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { role: 'admin' }, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true, user: { id: user._id, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/demote
router.post('/users/:id/demote', requireAdmin, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.userId)) {
      return res.status(400).json({ error: 'No puedes degradarte a ti mismo' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role: 'user' }, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true, user: { id: user._id, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/coins  body: { delta: number }
router.post('/users/:id/coins', requireAdmin, async (req, res) => {
  try {
    const { delta } = req.body;
    const deltaNum = Number(delta);
    if (!Number.isInteger(deltaNum) || deltaNum === 0) {
      return res.status(400).json({ error: 'Cantidad inválida' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const userId = new mongoose.Types.ObjectId(String(req.params.id));
    const updated = await Coins.findOneAndUpdate(
      { userId },
      { $inc: { balance: deltaNum, ...(deltaNum > 0 ? { totalEarned: deltaNum } : {}) } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (updated.balance < 0) {
      // No permitir balance negativo: revertir
      await Coins.updateOne({ userId }, { $inc: { balance: -deltaNum } });
      return res.status(400).json({ error: 'Balance no puede quedar negativo' });
    }
    await Transaction.create({
      fromUser: req.user.userId,
      toUser: userId,
      type: deltaNum > 0 ? 'gift_received' : 'gift_sent',
      amount: Math.abs(deltaNum),
      giftType: 'admin_adjust'
    });
    res.json({ success: true, balance: updated.balance });
  } catch (err) {
    console.error('admin/coins:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── REPORTES ──

// GET /api/admin/reports?status=pending
router.get('/reports', requireAdmin, async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const filter = status === 'all' ? {} : { status };
    const reports = await Report.find(filter)
      .populate('reportedBy', 'username')
      .populate('reportedUser', 'username banned')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    res.json({ reports });
  } catch (err) {
    console.error('admin/reports:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/reports/:id/resolve  body: { action: 'ban' | 'dismiss' }
router.post('/reports/:id/resolve', requireAdmin, async (req, res) => {
  try {
    const { action } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

    if (action === 'ban') {
      await User.findByIdAndUpdate(report.reportedUser, { banned: true });
      report.status = 'resolved';
    } else {
      report.status = 'dismissed';
    }
    report.resolvedAt = new Date();
    await report.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── TRANSACCIONES ──

// GET /api/admin/transactions?type=purchase&page=1&limit=50
router.get('/transactions', requireAdmin, async (req, res) => {
  try {
    const { type, page = 1, limit = 50 } = req.query;
    const filter = type ? { type } : {};
    const txs = await Transaction.find(filter)
      .populate('fromUser', 'username')
      .populate('toUser', 'username')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();
    const total = await Transaction.countDocuments(filter);
    res.json({ transactions: txs, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// ── STATS ──

// GET /api/admin/stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      bannedUsers,
      newToday,
      pendingReports,
      purchasesToday,
      purchasesMonth,
      giftsToday
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ banned: true }),
      User.countDocuments({ createdAt: { $gte: startOfDay } }),
      Report.countDocuments({ status: 'pending' }),
      Transaction.aggregate([
        { $match: { type: 'purchase', createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'purchase', createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),
      Transaction.countDocuments({ type: 'gift_sent', createdAt: { $gte: startOfDay } })
    ]);

    res.json({
      totalUsers,
      bannedUsers,
      newToday,
      pendingReports,
      coinsPurchasedToday: purchasesToday[0]?.total || 0,
      purchaseCountToday:  purchasesToday[0]?.count || 0,
      coinsPurchasedMonth: purchasesMonth[0]?.total || 0,
      purchaseCountMonth:  purchasesMonth[0]?.count || 0,
      giftsSentToday: giftsToday
    });
  } catch (err) {
    console.error('admin/stats:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
