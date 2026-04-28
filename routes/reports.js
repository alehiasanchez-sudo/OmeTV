const express = require('express');
const jwt = require('jsonwebtoken');
const Report = require('../models/Report');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

// Middleware auth
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// Crear reporte
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { reportedUserId, reason } = req.body;
    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: 'Faltan datos del reporte' });
    }
    const report = new Report({
      reportedBy: req.userId,
      reportedUser: reportedUserId,
      reason
    });
    await report.save();
    res.json({ message: 'Reporte enviado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al enviar reporte' });
  }
});

module.exports = router;
