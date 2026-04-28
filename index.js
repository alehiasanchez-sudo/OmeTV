const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

let waitingQueue = [];
let activePairs = {};

function removeFromQueue(socketId) {
  waitingQueue = waitingQueue.filter(id => id !== socketId);
}

function breakPair(socketId) {
  const partnerId = activePairs[socketId];
  if (partnerId) {
    delete activePairs[socketId];
    delete activePairs[partnerId];
  }
  return partnerId;
}

function findPartner(socket) {
  // Evitar duplicados en cola
  removeFromQueue(socket.id);

  // Buscar alguien válido en la cola (que no sea yo mismo)
  while (waitingQueue.length > 0) {
    const candidateId = waitingQueue.shift();
    if (candidateId === socket.id) continue; // nunca emparejarse consigo mismo
    const candidateSocket = io.sockets.sockets.get(candidateId);
    if (!candidateSocket) continue; // socket ya no existe

    // Pareja válida encontrada
    activePairs[socket.id] = candidateId;
    activePairs[candidateId] = socket.id;

    socket.emit('partner_found', { initiator: true });
    candidateSocket.emit('partner_found', { initiator: false });

    console.log(`Pareja formada: ${socket.id} <-> ${candidateId}`);
    return;
  }

  // Nadie disponible, entrar a la cola
  waitingQueue.push(socket.id);
  socket.emit('waiting');
  console.log(`En espera: ${socket.id}`);
}

io.on('connection', (socket) => {
  console.log(`Conectado: ${socket.id}`);

  socket.on('find_partner', () => {
    // Si ya tiene pareja activa, ignorar
    if (activePairs[socket.id]) return;
    findPartner(socket);
  });

  socket.on('signal', (data) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('signal', { ...data, from: socket.id });
    }
  });

  // "Siguiente": ambos buscan nueva pareja
  socket.on('next', () => {
    const partnerId = breakPair(socket.id);

    // Yo busco nueva pareja
    findPartner(socket);

    // Mi compañero también busca nueva pareja automáticamente
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        // Notificar al compañero para que limpie su WebRTC
        partnerSocket.emit('partner_skipped');
        // El servidor lo mete a la cola directamente
        findPartner(partnerSocket);
      }
    }
  });

  // "Detener": solo yo me desconecto, el otro queda en idle
  socket.on('stop', () => {
    const partnerId = breakPair(socket.id);
    removeFromQueue(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner_disconnected');
    }
  });

  socket.on('chat_message', (msg) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit('chat_message', { text: msg, from: 'stranger' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Desconectado: ${socket.id}`);
    removeFromQueue(socket.id);
    const partnerId = breakPair(socket.id);
    if (partnerId) {
      io.to(partnerId).emit('partner_disconnected');
    }
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
