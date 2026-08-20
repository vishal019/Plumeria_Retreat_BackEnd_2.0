const express = require('express');
const router = express.Router();
const pool = require('../dbcon'); // Now pool, not createConnection

const app = express();
app.use(express.json());

// Dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const [[{ totalBookings }]] = await pool.query('SELECT COUNT(*) AS totalBookings FROM bookings');
    const [[{ revenue }]] = await pool.query('SELECT IFNULL(SUM(total_amount),0) AS revenue FROM bookings WHERE payment_status="success"');
    const [[{ occupancyRate }]] = await pool.query('SELECT ROUND((SUM(rooms)/COUNT(*))*100,2) AS occupancyRate FROM bookings WHERE payment_status="success"');
    const [[{ websiteVisitors }]] = await pool.query('SELECT 1000 AS websiteVisitors'); // Placeholder

    // Dummy change values (implement your own logic if needed)
    const stats = {
      totalBookings,
      bookingChange: '+5%',
      occupancyRate: occupancyRate ? `${occupancyRate}%` : '0%',
      occupancyChange: '+2%',
      revenue: `₹${revenue}`,
      revenueChange: '+10%',
      websiteVisitors,
      visitorsChange: '+3%'
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// Quick stats
router.get('/quick-stats', async (req, res) => {
  try {
    const [[{ accommodations }]] = await pool.query('SELECT COUNT(*) AS accommodations FROM accommodations');
    const [[{ gallery }]] = await pool.query('SELECT COUNT(*) AS gallery FROM gallery_images');
    const [[{ services }]] = await pool.query('SELECT COUNT(*) AS services FROM activities');
    const [[{ todayBookings }]] = await pool.query('SELECT COUNT(*) AS todayBookings FROM bookings WHERE DATE(check_in) = CURDATE()');
    res.json({ accommodations, gallery, services, todayBookings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quick stats' });
  }
});

// Recent bookings
router.get('/recent-bookings', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        b.id, 
        b.guest_name AS guestName, 
        b.guest_email AS email, 
        a.name AS accommodation,  -- Changed from a.title to a.name
        b.check_in AS checkIn, 
        b.total_amount AS amount, 
        b.payment_status AS status
      FROM bookings b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      ORDER BY b.created_at DESC
      LIMIT 5
    `);
    
    res.json(rows);
    
  } catch (err) {
    console.error('Database error details:', {
      message: err.message,
      code: err.code,
      sqlState: err.sqlState,
      sql: err.sql
    });
    
    res.status(500).json({ 
      error: 'Failed to fetch recent bookings',
      ...(process.env.NODE_ENV === 'development' && {
        details: {
          message: err.message,
          code: err.code,
          sqlState: err.sqlState
        }
      })
    });
  }
});

module.exports = router;