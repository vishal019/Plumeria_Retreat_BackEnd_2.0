const express = require('express');
const bcrypt = require('bcrypt');
const cors = require('cors');
const pool = require('../dbcon'); // Import the database connection pool

const app = express();

// Middleware
// app.use(cors());
app.use(express.json());



// Admin Users Routes
const adminUsersRouter = express.Router();

// GET /admin/users - Fetch all users
adminUsersRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar,password FROM users ORDER BY id DESC'
    );
    
    // Format the response to match frontend expectations
    const users = rows.map(user => ({
      ...user,
      lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null
    }));
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ 
      error: 'Failed to fetch users',
      message: error.message 
    });
  }
});

// GET /admin/users/:id - Fetch single user
adminUsersRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [rows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar,password FROM users WHERE id = ?',
      [id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = {
      ...rows[0],
      lastLogin: rows[0].lastLogin ? rows[0].lastLogin.toISOString() : null
    };
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user',
      message: error.message 
    });
  }
});

// POST /admin/users - Create new user
adminUsersRouter.post('/', async (req, res) => {
  try {
    const { name, email, role, status, avatar, password } = req.body;
    
    // Validate required fields
    if (!name || !email || !role || !status || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'email', 'role', 'status', 'password']
      });
    }
    
    // Validate role enum
    const validRoles = ['admin', 'manager', 'staff'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role',
        validRoles 
      });
    }
    
    // Validate status enum
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses 
      });
    }
    
    // Check if email already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );
    
    if (existingUsers.length > 0) {
      return res.status(409).json({ 
        error: 'Email already exists' 
      });
    }
    
    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Insert new user
    const [result] = await pool.execute(
      'INSERT INTO users (name, email, role, status, avatar, password) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, role, status, 'https://example.com/avatars/charlie-davis.jpg' || null, hashedPassword]
    );
    
    // Fetch the created user (without password)
    const [newUserRows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [result.insertId]
    );
    
    const newUser = {
      ...newUserRows[0],
      lastLogin: newUserRows[0].lastLogin ? newUserRows[0].lastLogin.toISOString() : null
    };
    
    res.status(201).json(newUser);
    
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle duplicate email error specifically
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        error: 'Email already exists' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to create user',
      message: error.message 
    });
  }
});

// PUT /admin/users/:id - Update user
adminUsersRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, status, avatar, password } = req.body;
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Validate role if provided
    if (role) {
      const validRoles = ['admin', 'manager', 'staff'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ 
          error: 'Invalid role',
          validRoles 
        });
      }
    }
    
    // Validate status if provided
    if (status) {
      const validStatuses = ['active', 'inactive', 'suspended'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ 
          error: 'Invalid status',
          validStatuses 
        });
      }
    }
    
    // Check if email is being changed and if it already exists
    if (email) {
      const [emailCheck] = await pool.execute(
        'SELECT id FROM users WHERE email = ? AND id != ?',
        [email, id]
      );
      
      if (emailCheck.length > 0) {
        return res.status(409).json({ 
          error: 'Email already exists' 
        });
      }
    }
    
    // Build update query dynamically
    const updateFields = [];
    const updateValues = [];
    
    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    
    if (email) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    
    if (role) {
      updateFields.push('role = ?');
      updateValues.push(role);
    }
    
    if (status) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    
    if (avatar !== undefined) {
      updateFields.push('avatar = ?');
      updateValues.push(avatar);
    }
    
    if (password) {
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      updateFields.push('password = ?');
      updateValues.push(hashedPassword);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ 
        error: 'No fields to update' 
      });
    }
    
    // Add id to values for WHERE clause
    updateValues.push(id);
    
    // Execute update
    await pool.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );
    
    // Fetch updated user
    const [updatedUserRows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [id]
    );
    
    const updatedUser = {
      ...updatedUserRows[0],
      lastLogin: updatedUserRows[0].lastLogin ? updatedUserRows[0].lastLogin.toISOString() : null
    };
    
    res.json(updatedUser);
    
  } catch (error) {
    console.error('Error updating user:', error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        error: 'Email already exists' 
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to update user',
      message: error.message 
    });
  }
});

// DELETE /admin/users/:id - Delete user
adminUsersRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT id, name FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Delete user
    await pool.execute('DELETE FROM users WHERE id = ?', [id]);
    
    res.json({ 
      message: 'User deleted successfully',
      deletedUser: {
        id: parseInt(id),
        name: existingUsers[0].name
      }
    });
    
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ 
      error: 'Failed to delete user',
      message: error.message 
    });
  }
});

// PATCH /admin/users/:id/status - Update user status only
adminUsersRouter.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ 
        error: 'Status is required' 
      });
    }
    
    const validStatuses = ['active', 'inactive', 'suspended'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses 
      });
    }
    
    // Check if user exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update status
    await pool.execute(
      'UPDATE users SET status = ? WHERE id = ?',
      [status, id]
    );
    
    // Fetch updated user
    const [updatedUserRows] = await pool.execute(
      'SELECT id, name, email, role, status, phoneNumber, avatar FROM users WHERE id = ?',
      [id]
    );
    
    const updatedUser = {
      ...updatedUserRows[0],
      lastLogin: updatedUserRows[0].lastLogin ? updatedUserRows[0].lastLogin.toISOString() : null
    };
    
    res.json(updatedUser);
    
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ 
      error: 'Failed to update user status',
      message: error.message 
    });
  }
});

// POST /admin/users/:id/login - Update last login (utility endpoint)
adminUsersRouter.post('/:id/login', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if user exists and is active
    const [existingUsers] = await pool.execute(
      'SELECT id, status FROM users WHERE id = ?',
      [id]
    );
    
    if (existingUsers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (existingUsers[0].status !== 'active') {
      return res.status(403).json({ error: 'User is not active' });
    }
    
    // Update last login
    // await pool.execute(
    //   'UPDATE users SET lastLogin = NOW() WHERE id = ?',
    //   [id]
    // );
    
    // res.json({ 
    //   message: 'Last login updated successfully',
    //   timestamp: new Date().toISOString()
    // });
    
  } catch (error) {
    console.error('Error updating last login:', error);
    res.status(500).json({ 
      error: 'Failed to update last login',
      message: error.message 
    });
  }
});


module.exports = adminUsersRouter;
