const express = require('express');
const router = express.Router();
const pool = require('../dbcon');

// GET /admin/ratings - fetch all ratings
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT 
        id, 
        name AS guestName, 
        location AS propertyName, 
        image, 
        rating, 
        text AS review, 
        created_at AS date 
      FROM testimonials 
      ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching ratings:', error);
    res.status(500).json({ error: 'Failed to fetch ratings' });
  }
});

// DELETE /admin/ratings/:id - delete a rating
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM testimonials WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Rating not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting rating:', error);
    res.status(500).json({ error: 'Failed to delete rating' });
  }
});

module.exports = router;