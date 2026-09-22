const express = require('express');
const router = express.Router();
const pool = require('../dbcon');

// Auto-create banners table if not exists
let tableReadyPromise = null;
const ensureBannersTable = async (connection) => {
  if (!tableReadyPromise) {
    tableReadyPromise = (async () => {
      try {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS banners (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            subtitle VARCHAR(255) NULL,
            image_url TEXT NOT NULL,
            button_name VARCHAR(100) NULL DEFAULT 'Explore Stays',
            button_link VARCHAR(255) NULL DEFAULT '#campsites',
            accommodation_id INT NULL,
            badge_text VARCHAR(100) NULL,
            sort_order INT DEFAULT 0,
            active TINYINT(1) DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);

        // Check if accommodation_id column exists for existing tables
        const [cols] = await connection.query(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'banners'
        `);
        const colNames = new Set(cols.map((r) => (r.COLUMN_NAME || '').toLowerCase()));
        if (!colNames.has('accommodation_id')) {
          await connection.query('ALTER TABLE banners ADD COLUMN accommodation_id INT NULL');
        }
        if (!colNames.has('button_name')) {
          await connection.query("ALTER TABLE banners ADD COLUMN button_name VARCHAR(100) NULL DEFAULT 'Explore Stays'");
        }
        if (!colNames.has('button_link')) {
          await connection.query("ALTER TABLE banners ADD COLUMN button_link VARCHAR(255) NULL DEFAULT '#campsites'");
        }
        if (!colNames.has('badge_text')) {
          await connection.query('ALTER TABLE banners ADD COLUMN badge_text VARCHAR(100) NULL');
        }
      } catch (err) {
        console.warn('[Banners] Schema check warning:', err.message);
      }
    })();
  }
  return tableReadyPromise;
};

// GET / - List all banners (or active banners with ?active=true)
router.get('/', async (req, res) => {
  try {
    await ensureBannersTable(pool);
    const { active, search } = req.query;

    let query = `
      SELECT 
        b.id,
        b.title,
        b.subtitle,
        b.image_url,
        b.button_name,
        b.button_link,
        b.accommodation_id,
        b.badge_text,
        b.sort_order,
        b.active,
        b.created_at,
        b.updated_at,
        a.name AS accommodation_name,
        a.type AS accommodation_type,
        a.price AS accommodation_price
      FROM banners b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      WHERE 1=1
    `;
    const params = [];

    if (active === 'true' || active === '1') {
      query += ' AND b.active = 1';
    } else if (active === 'false' || active === '0') {
      query += ' AND b.active = 0';
    }

    if (search && search.trim()) {
      query += ' AND (b.title LIKE ? OR b.subtitle LIKE ? OR b.button_name LIKE ? OR a.name LIKE ?)';
      const like = `%${search.trim()}%`;
      params.push(like, like, like, like);
    }

    query += ' ORDER BY b.sort_order ASC, b.created_at DESC';

    const [rows] = await pool.execute(query, params);

    const formatted = rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle || '',
      image_url: r.image_url,
      button_name: r.button_name || 'Explore Stays',
      button_link: r.button_link || (r.accommodation_id ? `/campsites/${r.accommodation_id}` : '#campsites'),
      accommodation_id: r.accommodation_id || null,
      accommodation_name: r.accommodation_name || null,
      accommodation_type: r.accommodation_type || null,
      accommodation_price: r.accommodation_price || null,
      badge_text: r.badge_text || '',
      sort_order: r.sort_order || 0,
      active: Boolean(r.active),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    res.json({
      success: true,
      data: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error('Error fetching banners:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch banners',
      details: error.message,
    });
  }
});

// GET /:id - Get single banner
router.get('/:id', async (req, res) => {
  try {
    await ensureBannersTable(pool);
    const { id } = req.params;

    const [rows] = await pool.execute(
      `SELECT 
        b.*,
        a.name AS accommodation_name,
        a.type AS accommodation_type,
        a.price AS accommodation_price
      FROM banners b
      LEFT JOIN accommodations a ON b.accommodation_id = a.id
      WHERE b.id = ?`,
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Banner not found' });
    }

    const r = rows[0];
    res.json({
      success: true,
      data: {
        id: r.id,
        title: r.title,
        subtitle: r.subtitle || '',
        image_url: r.image_url,
        button_name: r.button_name || 'Explore Stays',
        button_link: r.button_link || (r.accommodation_id ? `/campsites/${r.accommodation_id}` : '#campsites'),
        accommodation_id: r.accommodation_id || null,
        accommodation_name: r.accommodation_name || null,
        accommodation_type: r.accommodation_type || null,
        badge_text: r.badge_text || '',
        sort_order: r.sort_order || 0,
        active: Boolean(r.active),
        created_at: r.created_at,
        updated_at: r.updated_at,
      },
    });
  } catch (error) {
    console.error('Error fetching banner:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch banner' });
  }
});

// POST / - Create new banner
router.post('/', async (req, res) => {
  try {
    await ensureBannersTable(pool);
    const {
      title,
      subtitle,
      image_url,
      image,
      src,
      button_name,
      button_link,
      accommodation_id,
      badge_text,
      sort_order,
      active,
    } = req.body;

    const finalImage = (image_url || image || src || '').trim();
    const finalTitle = (title || '').trim();

    if (!finalTitle) {
      return res.status(400).json({ success: false, error: 'Banner title is required' });
    }
    if (!finalImage) {
      return res.status(400).json({ success: false, error: 'Banner image is required' });
    }

    const finalAccId = accommodation_id ? Number(accommodation_id) : null;
    const finalBtnName = (button_name || 'Explore Stays').trim();
    const finalBtnLink = (button_link || (finalAccId ? `/campsites/${finalAccId}` : '#campsites')).trim();
    const finalActive = active === false || active === 0 || active === '0' ? 0 : 1;
    const finalSort = Number(sort_order) || 0;

    const [result] = await pool.execute(
      `INSERT INTO banners 
       (title, subtitle, image_url, button_name, button_link, accommodation_id, badge_text, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        finalTitle,
        subtitle ? subtitle.trim() : null,
        finalImage,
        finalBtnName,
        finalBtnLink,
        finalAccId,
        badge_text ? badge_text.trim() : null,
        finalSort,
        finalActive,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      id: result.insertId,
    });
  } catch (error) {
    console.error('Error creating banner:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create banner',
      details: error.message,
    });
  }
});

// PUT /:id - Update banner
router.put('/:id', async (req, res) => {
  try {
    await ensureBannersTable(pool);
    const { id } = req.params;
    const {
      title,
      subtitle,
      image_url,
      image,
      src,
      button_name,
      button_link,
      accommodation_id,
      badge_text,
      sort_order,
      active,
    } = req.body;

    const [existing] = await pool.execute('SELECT * FROM banners WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Banner not found' });
    }
    const current = existing[0];

    const finalTitle = title !== undefined ? String(title).trim() : current.title;
    const finalImage = (image_url || image || src) !== undefined ? String(image_url || image || src).trim() : current.image_url;
    const finalSubtitle = subtitle !== undefined ? (subtitle ? String(subtitle).trim() : null) : current.subtitle;
    const finalBtnName = button_name !== undefined ? String(button_name).trim() : current.button_name;
    const finalAccId = accommodation_id !== undefined ? (accommodation_id ? Number(accommodation_id) : null) : current.accommodation_id;
    const finalBtnLink = button_link !== undefined ? String(button_link).trim() : current.button_link;
    const finalBadge = badge_text !== undefined ? (badge_text ? String(badge_text).trim() : null) : current.badge_text;
    const finalSort = sort_order !== undefined ? Number(sort_order) : current.sort_order;
    const finalActive = active !== undefined ? (active === true || active === 1 || active === '1' ? 1 : 0) : current.active;

    await pool.execute(
      `UPDATE banners SET
        title = ?,
        subtitle = ?,
        image_url = ?,
        button_name = ?,
        button_link = ?,
        accommodation_id = ?,
        badge_text = ?,
        sort_order = ?,
        active = ?,
        updated_at = CURRENT_TIMESTAMP()
      WHERE id = ?`,
      [
        finalTitle,
        finalSubtitle,
        finalImage,
        finalBtnName,
        finalBtnLink,
        finalAccId,
        finalBadge,
        finalSort,
        finalActive,
        id,
      ]
    );

    res.json({
      success: true,
      message: 'Banner updated successfully',
      id,
    });
  } catch (error) {
    console.error('Error updating banner:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update banner',
      details: error.message,
    });
  }
});

// PATCH /:id/toggle - Toggle banner active status
router.patch('/:id/toggle', async (req, res) => {
  try {
    await ensureBannersTable(pool);
    const { id } = req.params;

    const [existing] = await pool.execute('SELECT active FROM banners WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Banner not found' });
    }

    const nextActive = existing[0].active ? 0 : 1;
    await pool.execute('UPDATE banners SET active = ?, updated_at = CURRENT_TIMESTAMP() WHERE id = ?', [nextActive, id]);

    res.json({
      success: true,
      message: `Banner ${nextActive ? 'activated' : 'deactivated'} successfully`,
      active: Boolean(nextActive),
    });
  } catch (error) {
    console.error('Error toggling banner status:', error);
    res.status(500).json({ success: false, error: 'Failed to toggle banner status' });
  }
});

// DELETE /:id - Delete banner
router.delete('/:id', async (req, res) => {
  try {
    await ensureBannersTable(pool);
    const { id } = req.params;

    const [result] = await pool.execute('DELETE FROM banners WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Banner not found' });
    }

    res.json({ success: true, message: 'Banner deleted successfully' });
  } catch (error) {
    console.error('Error deleting banner:', error);
    res.status(500).json({ success: false, error: 'Failed to delete banner' });
  }
});

module.exports = router;
