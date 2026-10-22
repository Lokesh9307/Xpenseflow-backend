require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB Atlas (Same DB as web app)
connectDB();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

const mongoose = require('mongoose');
const initKeepAliveCron = require('./cron/keepAlive');

// Health check endpoint (for Render & Keep-Alive Cron)
app.get(['/', '/api/health'], (req, res) => {
  const isMongoConnected = mongoose.connection.readyState === 1;
  res.json({
    status: isMongoConnected ? 'ok' : 'degraded',
    app: 'XpenseFlow Dedicated Backend',
    database: isMongoConnected ? 'MongoDB Atlas Connected' : 'MongoDB Disconnected',
    uptimeSeconds: Math.floor(process.uptime()),
    renderUrl: process.env.RENDER_EXTERNAL_URL || 'local',
    time: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/expenses', require('./routes/expenses'));
app.use('/api/income', require('./routes/income'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/budgets', require('./routes/budgets'));
app.use('/api/recurring', require('./routes/recurring'));
app.use('/api/split', require('./routes/split'));
app.use('/api/tiffin', require('./routes/tiffin'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/profile', require('./routes/profile'));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 XpenseFlow Backend running on port ${PORT}`);
  console.log(`📱 Local URL: http://localhost:${PORT}`);
  console.log(`🤖 Android Emulator URL: http://10.0.2.2:${PORT}`);
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`🌐 Render External URL: ${process.env.RENDER_EXTERNAL_URL}`);
  }
  console.log(`=======================================================`);

  // Start the 5-minute keep-alive health cron job to keep Render awake 24/7
  initKeepAliveCron(PORT);
});
