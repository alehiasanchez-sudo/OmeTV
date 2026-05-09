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
    const { reportedUserId, reason, screenshot, chatSnapshot } = req.body;
    if (!reportedUserId || !reason) {
      return res.status(400).json({ error: 'Faltan datos del reporte' });
    }
    // Validar que la captura no exceda ~3MB (base64) para evitar abuso
    if (screenshot && typeof screenshot === 'string' && screenshot.length > 3_500_000) {
      return res.status(413).json({ error: 'Captura demasiado grande' });
    }
    const report = new Report({
      reportedBy: req.userId,
      reportedUser: reportedUserId,
      reason,
      screenshot: typeof screenshot === 'string' ? screenshot : undefined,
      chatSnapshot: Array.isArray(chatSnapshot)
        ? chatSnapshot.slice(-50).map(m => ({ from: String(m.from || ''), text: String(m.text || '').slice(0, 500) }))
        : undefined
    });
    await report.save();
    console.log(`[Report] ${reportedUserId} | razón=${reason} | captura=${screenshot ? Math.round(screenshot.length / 1024) + 'KB' : 'NO'} | msgs=${Array.isArray(chatSnapshot) ? chatSnapshot.length : 0}`);
    res.json({ message: 'Reporte enviado correctamente' });
  } catch (err) {
    console.error('reports POST:', err);
    res.status(500).json({ error: 'Error al enviar reporte' });
  }
});

module.exports = router;
