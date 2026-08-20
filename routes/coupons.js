const express = require('express');
const router = express.Router();
const pool = require('../dbcon'); // Use the pool connection
const db = pool;


// Get all coupons with optional search
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    console.log('Fetching coupons with search:', search);

    let query = 'SELECT * FROM coupons';
    let queryParams = [];

    if (search && typeof search === 'string') {
      query += ' WHERE code = ? OR name = ?';
      const trimmedSearch = search.trim();
      queryParams = [trimmedSearch, trimmedSearch];
    }

    query += ' ORDER BY createdAt DESC';

    const [data] = await db.execute(query, queryParams);

    if (search && data.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon is invalid'
      });
    }

    res.json({
      success: true,
      data,
      message: 'Coupons fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch coupons',
      error: error.message
    });
  }
});



// Get single coupon by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.execute('SELECT * FROM coupons WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    res.json({
      success: true,
      data: rows[0],
      message: 'Coupon fetched successfully'
    });
  } catch (error) {
    console.error('Error fetching coupon:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch coupon',
      error: error.message
    });
  }
});

// Create new coupon
router.post('/', async (req, res) => {
  try {
    const {
      name,
      code,
      discount,
      discountType,
      minAmount,
      maxDiscount,
      usageLimit,
      active,
      expiryDate,
      accommodationType
    } = req.body;
    console.log('Creating coupon with data:', req.body);
    // Validation
    if (!code || !discount || !discountType || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: code, discount, discountType, expiryDate'
      });
    }

    // Check if coupon code already exists
    const [existingCoupon] = await db.execute('SELECT id FROM coupons WHERE code = ?', [code]);
    if (existingCoupon.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    // Validate discount percentage
    if (discountType === 'percentage' && discount > 100) {
      return res.status(400).json({
        success: false,
        message: 'Percentage discount cannot exceed 100%'
      });
    }

    // if (
    //   coupon.accommodationType.toLowerCase() !== 'all' &&
    //   coupon.accommodationType.trim().toLowerCase() !== propertyName.toLowerCase()
    // ) {
    //   return res.status(400).json({ success: false, message: "This coupon is not valid for the selected property." });
    // }

    // Validate expiry date
    if (new Date(expiryDate) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Expiry date must be in the future'
      });
    }

    const query = `
      INSERT INTO coupons (
        name, code, discount, discountType, minAmount, maxDiscount,
        usageLimit, active, expiryDate, accommodationType
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      name || null,
      code.trim().toUpperCase(),
      discount,
      discountType,
      minAmount || null,
      maxDiscount || null,
      usageLimit || null,
      active !== undefined ? active : true,
      expiryDate,
      accommodationType || 'all'
    ];

    const [result] = await db.execute(query, values);

    res.status(201).json({
      success: true,
      data: {
        id: result.insertId,
        code: code.trim().toUpperCase()
      },
      message: 'Coupon created successfully'
    });
  } catch (error) {
    console.error('Error creating coupon:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create coupon',
      error: error.message
    });
  }
});

// Update coupon
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      code,
      discount,
      discountType,
      minAmount,
      maxDiscount,
      usageLimit,
      active,
      expiryDate,
      accommodationType
    } = req.body;

    console.log('Updating coupon with ID:', id, 'and data:', req.body);
    // Check if coupon exists
    const [existingCoupon] = await db.execute('SELECT * FROM coupons WHERE id = ?', [id]);
    if (existingCoupon.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Validation
    if (!code || !discount || !discountType || !expiryDate) {
      return res.status(400).json({
        success: false,
        message: 'Required fields: code, discount, discountType, expiryDate'
      });
    }

    // Check if coupon code already exists for other coupons
    const [duplicateCheck] = await db.execute('SELECT id FROM coupons WHERE code = ? AND id != ?', [code, id]);
    if (duplicateCheck.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    // Validate discount percentage
    if (discountType === 'percentage' && discount > 100) {
      return res.status(400).json({
        success: false,
        message: 'Percentage discount cannot exceed 100%'
      });
    }

    // Validate expiry date
    if (new Date(expiryDate) <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Expiry date must be in the future'
      });
    }

    const query = `
      UPDATE coupons SET
        name = ?, code = ?, discount = ?, discountType = ?,
        minAmount = ?, maxDiscount = ?, usageLimit = ?,
        active = ?, expiryDate = ?, accommodationType = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const values = [
      name || null,
      code.trim().toUpperCase(),
      discount,
      discountType,
      minAmount || null,
      maxDiscount || null,
      usageLimit || null,
      active !== undefined ? active : true,
      expiryDate,
      accommodationType || 'all',
      id
    ];

    await db.execute(query, values);

    res.json({
      success: true,
      message: 'Coupon updated successfully'
    });
  } catch (error) {
    console.error('Error updating coupon:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update coupon',
      error: error.message
    });
  }
});

// Toggle coupon status (active/inactive)
router.patch('/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if coupon exists
    const [existingCoupon] = await db.execute('SELECT * FROM coupons WHERE id = ?', [id]);
    if (existingCoupon.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    const currentStatus = existingCoupon[0].active;
    const newStatus = !currentStatus;

    await db.execute(
      'UPDATE coupons SET active = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
      [newStatus, id]
    );

    res.json({
      success: true,
      message: `Coupon ${newStatus ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error toggling coupon status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update coupon status',
      error: error.message
    });
  }
});

// Delete coupon
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if coupon exists
    const [existingCoupon] = await db.execute('SELECT * FROM coupons WHERE id = ?', [id]);
    if (existingCoupon.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Coupon not found'
      });
    }

    // Check if coupon has been used (optional - you might want to prevent deletion of used coupons)
    if (existingCoupon[0].usedCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete coupon that has been used. Consider deactivating it instead.'
      });
    }

    await db.execute('DELETE FROM coupons WHERE id = ?', [id]);

    res.json({
      success: true,
      message: 'Coupon deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete coupon',
      error: error.message
    });
  }
});

module.exports = router;
