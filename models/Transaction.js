const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  fromUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['purchase', 'gift_sent', 'gift_received'], required: true },
  amount: { type: Number, required: true },
  giftType: { type: String },
  paypalOrderId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);
