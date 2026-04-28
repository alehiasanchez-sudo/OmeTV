const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');

const app = express();
app.use(cors({
  origin: ['https://ometvclient.vercel.app', 'https://tr-liveclient.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'ometv_secret_key_2024';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://THEROSARD:Terribles18161993@cluster0.b9honaj.mongodb.net/?appName=Cluster0';

// Conectar MongoDB
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

// Rutas REST
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['https://ometvclient.vercel.app', 'https://tr-liveclient.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

// ── Matchmaking ──
// Cola por país: { socketId, userId, country, username }
let waitingQueue = [];
let activePairs = {}; // socketId -> { partnerId, partnerUserId, partnerUsername }

function removeFromQueue(socketId) {
  waitingQueue = waitingQueue.filter(u => u.socketId !== socketId);
}

function breakPair(socketId) {
  const pair = activePairs[socketId];
  if (pair) {
    delete activePairs[socketId];
    delete activePairs[pair.partnerId];
  }
  return pair;
}

function findPartner(socket, userInfo) {
  removeFromQueue(socket.id);

  // Primero buscar del mismo país
  let idx = waitingQueue.findIndex(u => u.socketId !== socket.id && u.country === userInfo.country);

  // Si no hay del mismo país, buscar cualquiera
  if (idx === -1) {
    idx = waitingQueue.findIndex(u => u.socketId !== socket.id);
  }

  if (idx !== -1) {
    const candidate = waitingQueue.splice(idx, 1)[0];
    const candidateSocket = io.sockets.sockets.get(candidate.socketId);

    if (!candidateSocket) {
      // Socket ya no existe, intentar de nuevo
      findPartner(socket, userInfo);
      return;
    }

    activePairs[socket.id] = { partnerId: candidate.socketId, partnerUserId: candidate.userId, partnerUsername: candidate.username };
    activePairs[candidate.socketId] = { partnerId: socket.id, partnerUserId: userInfo.userId, partnerUsername: userInfo.username };

    socket.emit('partner_found', {
      initiator: true,
      partnerUsername: candidate.username,
      partnerCountry: candidate.country,
      partnerUserId: candidate.userId,
      partnerGender: candidate.gender
    });
    candidateSocket.emit('partner_found', {
      initiator: false,
      partnerUsername: userInfo.username,
      partnerCountry: userInfo.country,
      partnerUserId: userInfo.userId,
      partnerGender: userInfo.gender
    });

    console.log(`Pareja: ${userInfo.username}(${userInfo.country}) <-> ${candidate.username}(${candidate.country})`);
  } else {
    waitingQueue.push({ socketId: socket.id, ...userInfo });
    socket.emit('waiting');
    console.log(`En espera: ${userInfo.username} (${userInfo.country})`);
  }
}

// Mapa socketId -> userInfo
const connectedUsers = {};

io.on('connection', (socket) => {
  console.log(`Conectado: ${socket.id}`);

  // Autenticar socket con JWT
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      connectedUsers[socket.id] = {
        userId: decoded.userId,
        username: decoded.username || 'Usuario',
        country: decoded.country || 'Unknown',
        gender: decoded.gender || 'other'
      };
      socket.emit('authenticated');
    } catch {
      socket.emit('auth_error', 'Token inválido');
    }
  });

  socket.on('find_partner', () => {
    const userInfo = connectedUsers[socket.id];
    if (!userInfo) return socket.emit('auth_error', 'No autenticado');
    if (activePairs[socket.id]) return;
    findPartner(socket, userInfo);
  });

  socket.on('signal', (data) => {
    const pair = activePairs[socket.id];
    if (pair) {
      io.to(pair.partnerId).emit('signal', { ...data, from: socket.id });
    }
  });

  socket.on('next', () => {
    const pair = breakPair(socket.id);
    const userInfo = connectedUsers[socket.id];
    if (!userInfo) return;

    findPartner(socket, userInfo);

    if (pair) {
      const partnerSocket = io.sockets.sockets.get(pair.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('partner_skipped');
        const partnerInfo = connectedUsers[pair.partnerId];
        if (partnerInfo) findPartner(partnerSocket, partnerInfo);
      }
    }
  });

  socket.on('stop', () => {
    const pair = breakPair(socket.id);
    removeFromQueue(socket.id);
    if (pair) {
      io.to(pair.partnerId).emit('partner_disconnected');
    }
  });

  socket.on('chat_message', (msg) => {
    const pair = activePairs[socket.id];
    if (pair) {
      io.to(pair.partnerId).emit('chat_message', { text: msg, from: 'stranger' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Desconectado: ${socket.id}`);
    removeFromQueue(socket.id);
    const pair = breakPair(socket.id);
    if (pair) {
      io.to(pair.partnerId).emit('partner_disconnected');
    }
    delete connectedUsers[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
