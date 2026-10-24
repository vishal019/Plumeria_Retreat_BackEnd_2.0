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
    'https://plumeriaretreat.com',
    'https://testplumeriaretreat.digitaldiaries.in',
    'https://adminplumeriaretreat.digitaldiaries.in'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory exists and serve static files
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

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

// Pool attachment
app.use((req, res, next) => {
  req.pool = pool;
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

// Dynamic Sitemap generator for Google Web Crawler
app.get('/sitemap.xml', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, name, slug, updated_at FROM accommodations WHERE available = 1 ORDER BY id ASC"
    );

    const baseUrl = 'https://plumeriaretreat.com';
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    const staticPages = [
      { path: '/', priority: '1.0', changefreq: 'daily' },
      { path: '/explore', priority: '0.9', changefreq: 'daily' },
      { path: '/gallery', priority: '0.7', changefreq: 'weekly' },
      { path: '/about', priority: '0.6', changefreq: 'monthly' },
      { path: '/contact', priority: '0.6', changefreq: 'monthly' },
    ];

    for (const p of staticPages) {
      xml += `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>\n`;
    }

    for (const acc of rows) {
      const slugVal = acc.slug || String(acc.name || '')
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || acc.id;

      const lastmod = acc.updated_at ? new Date(acc.updated_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      xml += `  <url>\n    <loc>${baseUrl}/stays/${slugVal}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.9</priority>\n  </url>\n`;
    }

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.status(200).send(xml);
  } catch (err) {
    console.error('Error generating dynamic sitemap:', err);
    res.status(500).send('Error generating sitemap');
  }
});

// Dynamic robots.txt
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(
`User-agent: Googlebot
Allow: /
Allow: /stays/
Allow: /explore
Allow: /gallery
Allow: /about
Allow: /contact

User-agent: *
Allow: /
Disallow: /admin/
Disallow: /payment/
Disallow: /failure
Disallow: /cancel

Sitemap: https://plumeriaretreat.com/sitemap.xml
`
  );
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
loadRoutes('./routes/properties', '/properties');
loadRoutes('./routes/properties', '/api/properties');
loadRoutes('./routes/gallery', '/admin/gallery');
loadRoutes('./routes/users', '/admin/users');
loadRoutes('./routes/coupons', '/admin/coupons');
loadRoutes('./routes/cities', '/admin/cities');
loadRoutes('./routes/ammenities', '/admin/amenities');
loadRoutes('./routes/bookings', '/admin/bookings');
loadRoutes('./routes/bookings', '/api/bookings');
loadRoutes('./routes/bookings', '/bookings');
loadRoutes('./routes/bookings', '/api');
loadRoutes('./routes/ratings', '/admin/ratings');
loadRoutes('./routes/ratings', '/ratings');
loadRoutes('./routes/categories', '/admin/categories');
loadRoutes('./routes/categories', '/categories');
loadRoutes('./routes/calendar', '/admin/calendar');
loadRoutes('./routes/calendar', '/calendar');
loadRoutes('./routes/banners', '/admin/banners');
loadRoutes('./routes/banners', '/api/banners');
loadRoutes('./routes/banners', '/banners');

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
