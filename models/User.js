const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  password: { type: String, required: true },
  username: { type: String, required: true, unique: true },
  age: { type: Number, required: true },
  gender: { type: String, enum: ['male', 'female', 'other'], required: true },
  country: { type: String, required: true },
  banned: { type: Boolean, default: false },
  role: { type: String, enum: ['user', 'admin', 'owner'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
