const express = require('express');
const router = express.Router();
const pool = require('../dbcon');

// GET all amenities
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM amenities ORDER BY id DESC');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch amenities' });
  }
});

// POST create amenity
router.post('/', async (req, res) => {
  try {
    const { name, icon, active = 1 } = req.body;
    if (!name || !icon) return res.status(400).json({ error: 'Name and icon required' });
    const [result] = await pool.execute(
      'INSERT INTO amenities (name, icon, active) VALUES (?, ?, ?)',
      [name, icon, active]
    );
    res.status(201).json({ id: result.insertId, name, icon, active });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add amenity' });
  }
});

// PUT update amenity
router.put('/:id', async (req, res) => {
  try {
    const { name, icon, active } = req.body;
    const { id } = req.params;
    await pool.execute(
      'UPDATE amenities SET name=?, icon=?, active=? WHERE id=?',
      [name, icon, active, id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update amenity' });
  }
});

// DELETE amenity
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.execute('DELETE FROM amenities WHERE id=?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete amenity' });
  }
});

module.exports = router;
