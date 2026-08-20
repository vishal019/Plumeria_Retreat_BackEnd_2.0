const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const process = require('process');
const dotenv = require('dotenv');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const safeParse = require('./utils/safeParse');
const pool = require('./dbcon');

dotenv.config();
const app = express();
const port = process.env.PORT || 5000;
app.use(express.urlencoded({ extended: true }));
// Setup logging
const accessLogStream = fs.createWriteStream(
  path.join(__dirname, 'access.log'), 
  { flags: 'a' }
);
app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('dev')); // Log to console in development

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'https://adminplumeria.vercel.app',
    'https://www.plumeriaretreat.com',
    'https://admin.plumeriaretreat.com',
    'https://www.admin.plumeriaretreat.com',
    'https://plumeriaretreat.vercel.app',
    'http://localhost:5174',
    'https://plumeriaretreat.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Make safeParse globally available
app.use((req, res, next) => {
  req.safeParse = safeParse;
  next();
});

// Request timeout handling
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout' });
    }
  });
  next();
});

// Database connection middleware
app.use(async (req, res, next) => {
  let conn;
  try {
    conn = await pool.getConnection();
    req.db = conn;
    next();
  } catch (err) {
    console.error('DB Connection Error:', err);
    if (conn) await conn.release().catch(e => console.error('Release error:', e));
    res.status(503).json({ 
      error: 'Service unavailable',
      message: 'Database connection failed'
    });
  }
});

// Ensure connections are released
app.use((req, res, next) => {
  res.on('finish', async () => {
    if (req.db) {
      try {
        await req.db.release();
      } catch (err) {
        console.error('Connection release error:', err);
      }
    }
  });
  next();
});

// Health check endpoints
app.get('/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS health_check');
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Safe route loader function
const loadRoutes = (routePath, routePrefix) => {
  try {
    const router = require(routePath);
    app.use(routePrefix, router);
    console.log(`✅ Route loaded: ${routePath}`);
  } catch (err) {
    console.error(`❌ Failed to load route ${routePath}:`, err.message);
    if (err.message.includes('Missing parameter name')) {
      console.error('This error typically indicates a malformed route path with missing parameter names');
    }
  }
};

// Load all routes with error handling
loadRoutes('./routes/dashboard', '/admin/dashboard');
loadRoutes('./routes/properties', '/admin/properties');
loadRoutes('./routes/gallery', '/admin/gallery');
loadRoutes('./routes/users', '/admin/users');
loadRoutes('./routes/coupons', '/admin/coupons');
loadRoutes('./routes/cities', '/admin/cities');
loadRoutes('./routes/ammenities', '/admin/amenities');
loadRoutes('./routes/bookings', '/admin/bookings');
loadRoutes('./routes/ratings', '/admin/ratings');
loadRoutes('./routes/calendar', '/admin/calendar');

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `The requested resource ${req.path} was not found`,
    timestamp: new Date().toISOString()
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error:', err);
  
  if (err instanceof TypeError && err.message.includes('Missing parameter name')) {
    return res.status(500).json({
      error: 'Invalid route configuration',
      message: 'Server route configuration error',
      timestamp: new Date().toISOString()
    });
  }
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n[Shutdown] Starting graceful shutdown...');
  
  try {
    await pool.end();
    console.log('[Shutdown] Database pool closed successfully');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Error closing pool:', err);
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the server
const server = app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

// Handle server errors
server.on('error', (err) => {
  console.error('Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use`);
  }
});
