const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Coins = require('../models/Coins');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

// ── Middlewares: jerarquía owner > admin > user ──
const ROLE_RANK = { user: 0, admin: 1, owner: 2 };

const requireRole = (minRole) => async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Verificar role en DB (no confiar sólo en JWT por si fue degradado).
    const user = await User.findById(decoded.userId).select('role banned');
    if (!user || user.banned) return res.status(403).json({ error: 'Acceso denegado' });
    const userRank = ROLE_RANK[user.role] ?? 0;
    if (userRank < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `Se requiere rol ${minRole} o superior` });
    }
    req.user = { ...decoded, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

const requireAdmin = requireRole('admin'); // admin y owner
const requireOwner = requireRole('owner'); // sólo owner

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
    const target = await User.findById(req.params.id).select('role banned');
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'owner') return res.status(403).json({ error: 'No se puede banear a un owner' });
    if (target.role === 'admin' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Solo el owner puede banear admins' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { banned: true }, { new: true });
    res.json({ success: true, user: { id: user._id, banned: user.banned } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', requireAdmin, async (req, res) => {
  try {
    const target = await User.findById(req.params.id).select('role');
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'admin' && req.user.role !== 'owner') {
      return res.status(403).json({ error: 'Solo el owner puede desbanear admins' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { banned: false }, { new: true });
    res.json({ success: true, user: { id: user._id, banned: user.banned } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/promote — sólo owner
router.post('/users/:id/promote', requireOwner, async (req, res) => {
  try {
    // Sólo se puede promover a 'admin', no a 'owner' (eso se hace manualmente en DB).
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'owner') return res.status(400).json({ error: 'No se puede modificar a un owner' });
    target.role = 'admin';
    await target.save();
    res.json({ success: true, user: { id: target._id, role: target.role } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/admin/users/:id/demote — sólo owner
router.post('/users/:id/demote', requireOwner, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.userId)) {
      return res.status(400).json({ error: 'No puedes degradarte a ti mismo' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'owner') return res.status(400).json({ error: 'No se puede degradar a un owner' });
    target.role = 'user';
    await target.save();
    res.json({ success: true, user: { id: target._id, role: target.role } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/admin/users/:id — sólo owner — elimina usuario y sus datos asociados
router.delete('/users/:id', requireOwner, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.userId)) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'owner') return res.status(400).json({ error: 'No se puede eliminar a un owner' });

    const userId = target._id;
    await Promise.all([
      User.deleteOne({ _id: userId }),
      Coins.deleteOne({ userId }),
      Report.deleteMany({ $or: [{ reportedBy: userId }, { reportedUser: userId }] }),
      // Transacciones se conservan para auditoría — no las borramos.
    ]);

    res.json({ success: true, deleted: target.username });
  } catch (err) {
    console.error('admin delete:', err);
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

    // Conteo total de reportes acumulados por cada usuario reportado (todas las fechas / estados).
    const reportedIds = [...new Set(reports.map(r => r.reportedUser?._id).filter(Boolean).map(String))];
    const counts = await Report.aggregate([
      { $match: { reportedUser: { $in: reportedIds.map(id => new mongoose.Types.ObjectId(id)) } } },
      { $group: { _id: '$reportedUser', total: { $sum: 1 } } }
    ]);
    const countsMap = {};
    counts.forEach(c => { countsMap[String(c._id)] = c.total; });

    reports.forEach(r => {
      if (r.reportedUser) {
        r.reportedUser.totalReports = countsMap[String(r.reportedUser._id)] || 0;
      }
    });

    res.json({ reports });
  } catch (err) {
    console.error('admin/reports:', err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// DELETE /api/admin/reports/:id — elimina el reporte y limpia todos los demás del mismo usuario
router.delete('/reports/:id', requireAdmin, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id).select('reportedUser');
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });
    const result = await Report.deleteMany({ reportedUser: report.reportedUser });
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('admin delete report:', err);
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
      const target = await User.findById(report.reportedUser).select('role');
      if (!target) return res.status(404).json({ error: 'Usuario reportado no encontrado' });
      if (target.role === 'owner') return res.status(403).json({ error: 'No se puede banear a un owner' });
      if (target.role === 'admin' && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Solo el owner puede banear admins' });
      }
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

// GET /api/admin/transactions?type=purchase&page=1&limit=50 — sólo owner
router.get('/transactions', requireOwner, async (req, res) => {
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
