const express = require('express');
const router = express.Router();
const pool = require('../dbcon');

// Helper to initialize table if it doesn't exist
const initTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                image VARCHAR(255),
                status ENUM('active', 'inactive') DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
    } catch (err) {
        console.error('Error creating categories table:', err);
    }
};

initTable();

// Get all categories
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories ORDER BY id DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching categories' });
    }
});

// Add new category
router.post('/', async (req, res) => {
    try {
        const { name, image, status } = req.body;
        if (!name) return res.status(400).json({ error: 'Category name is required' });
        
        const [result] = await pool.query(
            'INSERT INTO categories (name, image, status) VALUES (?, ?, ?)',
            [name, image || '', status || 'active']
        );
        
        const [newCategory] = await pool.query('SELECT * FROM categories WHERE id = ?', [result.insertId]);
        res.status(201).json(newCategory[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error creating category' });
    }
});

// Update category
router.put('/:id', async (req, res) => {
    try {
        const { name, image, status } = req.body;
        const { id } = req.params;
        
        await pool.query(
            'UPDATE categories SET name = ?, image = ?, status = ? WHERE id = ?',
            [name, image || '', status || 'active', id]
        );
        
        const [updated] = await pool.query('SELECT * FROM categories WHERE id = ?', [id]);
        if (updated.length === 0) return res.status(404).json({ error: 'Category not found' });
        
        res.json(updated[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error updating category' });
    }
});

// Delete category
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
        
        res.json({ message: 'Category deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error deleting category' });
    }
});

module.exports = router;
