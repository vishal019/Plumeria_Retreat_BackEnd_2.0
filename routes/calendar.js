const express = require('express');
const router = express.Router();
const pool = require('../dbcon');
const cron = require('node-cron');

cron.schedule('0 2 * * *', async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // midnight today

    const [result] = await pool.execute(
      `DELETE FROM blocked_dates WHERE blocked_date < ?`,
      [today]
    );

    console.log(`[CRON] Deleted ${result.affectedRows} expired blocked_dates`);
  } catch (err) {
    console.error('[CRON] Error deleting past blocked dates:', err);
  }
});

// GET /admin/calendar/blocked-dates
// GET all blocked dates
router.get('/blocked-dates', async (req, res) => {
  console.log('Fetching blocked dates');

  try {
    const [rows] = await pool.execute(`
      SELECT 
        bd.id, 
        DATE_FORMAT(bd.blocked_date, '%Y-%m-%d') AS blocked_date,
        bd.reason, 
        bd.accommodation_id, 
        bd.rooms,
        a.name AS accommodation_name,
        bd.adult_price,
        bd.child_price,
        bd.created_at,
        bd.updated_at
      FROM blocked_dates bd
      LEFT JOIN accommodations a ON bd.accommodation_id = a.id
      ORDER BY bd.blocked_date DESC
    `);

    const formattedRows = rows.map(r => ({
  ...r,
  rooms: r.rooms !== null ? r.rooms.toString() : "0",
  reason: r.reason || "",
  created_at: r.created_at ? r.created_at.toLocaleString('en-GB', { hour12: false }) : null,
  updated_at: r.updated_at ? r.updated_at.toLocaleString('en-GB', { hour12: false }) : null
}));

    res.json({ success: true, data: formattedRows });
  } catch (error) {
    console.error('Error fetching blocked dates:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch blocked dates' });
  }
});

// GET blocked dates by accommodation_id
router.get('/blocked-dates/:id', async (req, res) => {
  const accommodation_id = req.params.id;
  console.log('Fetching blocked dates for accommodation_id:', accommodation_id);

  try {
    let query = `
      SELECT
        bd.id,
        DATE_FORMAT(bd.blocked_date, '%Y-%m-%d') AS blocked_date,
        bd.reason,
        bd.accommodation_id,
        bd.rooms,
        a.name AS accommodation_name,
        bd.adult_price,
        bd.child_price,
        bd.created_at,
        bd.updated_at
      FROM blocked_dates bd
      LEFT JOIN accommodations a ON bd.accommodation_id = a.id
    `;
    const params = [];
    if (accommodation_id) {
      query += ` WHERE bd.accommodation_id = ?`;
      params.push(accommodation_id);
    }
    query += ` ORDER BY bd.blocked_date DESC`;

    const [rows] = await pool.execute(query, params);

    const formattedRows = rows.map(r => ({
  ...r,
  rooms: r.rooms !== null ? r.rooms.toString() : "0",
  reason: r.reason || "",
  created_at: r.created_at ? r.created_at.toLocaleString('en-GB', { hour12: false }) : null,
  updated_at: r.updated_at ? r.updated_at.toLocaleString('en-GB', { hour12: false }) : null
}));

    res.json({ success: true, data: formattedRows });
  } catch (error) {
    console.error('Error fetching blocked dates:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch blocked dates' });
  }
});



// POST /admin/calendar/blocked-dates
// POST /blocked-dates
router.post('/blocked-dates', async (req, res) => {
  try {
    const { dates, reason, accommodation_id, room_number, adult_price, child_price } = req.body;

    console.log('Blocking dates:', {
      dates,
      reason,
      accommodation_id,
      room_number,
      adult_price,
      child_price
    });

    if (!dates || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ success: false, message: 'No dates provided' });
    }

    const now = new Date(); // Node-generated timestamp

    const values = dates.map(date => [
      date,
      reason,
      accommodation_id,
      String(room_number),
      adult_price,
      child_price,
      now,
      now
    ]);

    const placeholders = values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");

    await pool.execute(
      `INSERT INTO blocked_dates 
       (blocked_date, reason, accommodation_id, rooms, adult_price, child_price, created_at, updated_at)
       VALUES ${placeholders}`,
      values.flat()
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error blocking dates:', error);
    res.status(500).json({ success: false, message: 'Failed to block dates' });
  }
});

// PUT /blocked-dates/:id
router.put('/blocked-dates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, accommodation_id, room_number, adult_price, child_price } = req.body;

    const now = new Date(); // Node-generated timestamp for update

    const [result] = await pool.execute(
      `UPDATE blocked_dates 
       SET reason=?, accommodation_id=?, rooms=?, adult_price=?, child_price=?, updated_at=? 
       WHERE id=?`,
      [reason, accommodation_id, String(room_number), adult_price, child_price, now, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Blocked date not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating blocked date:', error);
    res.status(500).json({ success: false, message: 'Failed to update blocked date' });
  }
});


router.delete('/blocked-dates/cleanup', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Midnight (start of today)

    const [result] = await pool.execute(
      `DELETE FROM blocked_dates WHERE blocked_date < ?`,
      [today]
    );

    res.json({
      success: true,
      message: `${result.affectedRows} past blocked date(s) deleted.`,
    });
  } catch (error) {
    console.error('Error deleting past blocked dates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete past blocked dates.',
    });
  }
});

// DELETE /admin/calendar/blocked-dates/:id
router.delete('/blocked-dates/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM blocked_dates WHERE id=?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting blocked date:', error);
    res.status(500).json({ success: false, message: 'Failed to delete blocked date' });
  }
});

// GET /admin/calendar/accommodations
router.get('/accommodations', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, title AS name, type FROM accommodations');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch accommodations' });
  }
});

module.exports = router;