const cron = require('node-cron');
const mongoose = require('mongoose');

/**
 * Keep-Alive Cron Job for Render Deployment
 * 
 * Render spins down free tier instances after 15 minutes of inactivity.
 * This cron job executes every 5 minutes to ping the /api/health endpoint
 * via an incoming HTTP request, ensuring the instance remains active 24/7.
 */
function initKeepAliveCron(port) {
  const getTargetUrl = () => {
    // 1. Render automatically sets RENDER_EXTERNAL_URL (e.g., https://my-app.onrender.com)
    if (process.env.RENDER_EXTERNAL_URL) {
      return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
    }
    // 2. Custom SERVER_URL if set in environment
    if (process.env.SERVER_URL) {
      return process.env.SERVER_URL.replace(/\/+$/, '');
    }
    // 3. Render hostname fallback
    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
      return `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`;
    }
    // 4. Localhost fallback
    return `http://localhost:${port || process.env.PORT || 5000}`;
  };

  const pingHealth = async (triggerType = 'CRON') => {
    const baseUrl = getTargetUrl();
    const healthUrl = `${baseUrl}/api/health`;

    try {
      const startTime = Date.now();
      const res = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'XpenseFlow-KeepAlive-Cron/1.0' },
      });
      const duration = Date.now() - startTime;

      const isMongoConnected = mongoose.connection.readyState === 1;

      console.log(
        `[${new Date().toLocaleTimeString()}] [${triggerType} KEEP-ALIVE] Health check ping to ${healthUrl} -> Status: ${res.status} (${duration}ms) | DB: ${isMongoConnected ? 'CONNECTED' : 'DISCONNECTED'}`
      );
    } catch (err) {
      console.warn(
        `[${new Date().toLocaleTimeString()}] [${triggerType} KEEP-ALIVE] Ping warning for ${healthUrl}: ${err.message}`
      );
    }
  };

  // Schedule cron job to run every 5 minutes: '*/5 * * * *'
  const cronSchedule = '*/5 * * * *';
  cron.schedule(cronSchedule, () => {
    pingHealth('CRON (5m)');
  });

  console.log(`⏱️ Keep-Alive Cron initialized: running every 5 minutes ('${cronSchedule}')`);
  console.log(`🌐 Target Ping Base URL: ${getTargetUrl()}`);

  // Initial warm-up ping after 30 seconds
  setTimeout(() => {
    pingHealth('INITIAL WARM-UP');
  }, 30000);
}

module.exports = initKeepAliveCron;
