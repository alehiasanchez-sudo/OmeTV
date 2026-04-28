const mongoose = require('mongoose');

const coinsSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 }
});

module.exports = mongoose.model('Coins', coinsSchema);
