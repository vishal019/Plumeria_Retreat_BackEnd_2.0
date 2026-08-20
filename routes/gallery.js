const express = require('express');
const router = express.Router();
const pool = require('../dbcon');


// GET /admin/gallery - fetch images with optional filters
router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT id, src AS image_url, alt AS alt_text, category, width, height, created_at FROM gallery_images WHERE 1=1';
    const params = [];
    if (category && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      query += ' AND (alt LIKE ? OR src LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.execute(query, params);
    res.json({
      images: rows,
      total: rows.length,
      limit: rows.length,
      offset: 0
    });
  } catch (error) {
    console.error('Error fetching gallery images:', error);
    res.status(500).json({ error: 'Failed to fetch gallery images' });
  }
});

// GET /admin/gallery/stats - get image stats by category
router.get('/stats', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT category, COUNT(*) as count FROM gallery_images GROUP BY category'
    );
    const [totalRow] = await pool.execute('SELECT COUNT(*) as total FROM gallery_images');
    res.json({
      total: totalRow[0].total,
      by_category: rows
    });
  } catch (error) {
    console.error('Error fetching gallery stats:', error);
    res.status(500).json({ error: 'Failed to fetch gallery stats' });
  }
});

// POST /admin/gallery/upload - add new images (metadata only, extend for file upload)
router.post('/upload', async (req, res) => {
  try {
    // For demo: expects JSON body with src, alt, category, width, height
    // In production, use multer for file uploads
    const { images, category, title, alt_text, description } = req.body;
    if (!images || !Array.isArray(images)) {
      return res.status(400).json({ error: 'No images provided' });
    }
    const inserted = [];
    for (const img of images) {
      const [result] = await pool.execute(
        'INSERT INTO gallery_images (src, alt, category, width, height) VALUES (?, ?, ?, ?, ?)',
        [img.src, img.alt || alt_text || '', category || img.category || 'accommodation', img.width || 300, img.height || 300]
      );
      inserted.push({
        id: result.insertId,
        src: img.src,
        alt: img.alt || alt_text || '',
        category: category || img.category || 'accommodation',
        width: img.width || 300,
        height: img.height || 300
      });
    }
    res.status(201).json({ images: inserted });
  } catch (error) {
    console.error('Error uploading images:', error);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// DELETE /admin/gallery/:id - delete image
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM gallery_images WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

module.exports = router;
