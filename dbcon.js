const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const activeConnections = new Set();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'in-mum-web1671.main-hosting.eu',
  user: process.env.DB_USER || 'u973488458_plumeria',
  password: process.env.DB_PASSWORD || 'Plumeria_retreat1234',
  database: process.env.DB_NAME || 'u973488458_plumeria',
  port: parseInt(process.env.DB_PORT || '3306'),
  
  // Conservative pool settings
  connectionLimit: 5,
  waitForConnections: false,
  queueLimit: 0,
  connectTimeout: 10000,
  idleTimeout: 30000,
  maxIdle: 2,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  namedPlaceholders: true
});

// Connection monitoring
pool.on('acquire', (connection) => {
  activeConnections.add(connection.threadId);
  console.log(`Connection acquired (${connection.threadId}), Active: ${activeConnections.size}`);
  
  // Set timeout to detect leaks
  connection.leakTimer = setTimeout(() => {
    console.error(`Connection ${connection.threadId} potentially leaked!`);
  }, 60000);
});

pool.on('release', (connection) => {
  activeConnections.delete(connection.threadId);
  clearTimeout(connection.leakTimer);
  console.log(`Connection released (${connection.threadId}), Active: ${activeConnections.size}`);
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
  if (err.code === 'ER_USER_LIMIT_REACHED') {
    console.log('Waiting 10 seconds before retrying...');
    setTimeout(() => pool.getConnection().then(conn => conn.release()), 10000);
  }
});

// Health check
async function checkPoolHealth() {
  console.log(`Pool status: Total=${pool.totalCount}, Active=${activeConnections.size}, Idle=${pool.idleCount}`);
  
  if (activeConnections.size > 20) {
    console.warn('WARNING: Approaching connection limit!');
  }
}

setInterval(checkPoolHealth, 30000);

// Graceful shutdown
const shutdown = async () => {
  console.log('\nClosing pool with', activeConnections.size, 'active connections...');
  await pool.end();
  process.exit();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = pool;