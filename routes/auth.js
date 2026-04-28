const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';

// Registro
router.post('/register', async (req, res) => {
  try {
    const { username, password, age, gender, country } = req.body;

    if (!username || !password || !age || !gender || !country) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }

    if (age < 18) {
      return res.status(400).json({ error: 'Debes tener al menos 18 años' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Nombre de usuario ya en uso' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, age, gender, country });
    await user.save();

    const token = jwt.sign(
      { userId: user._id, username: user.username, country: user.country, gender: user.gender },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user._id, username: user.username, country: user.country, gender: user.gender } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Credenciales incorrectas' });

    if (user.banned) return res.status(403).json({ error: 'Tu cuenta ha sido suspendida' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { userId: user._id, username: user.username, country: user.country, gender: user.gender },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user._id, username: user.username, country: user.country, gender: user.gender } });
  } catch (err) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
