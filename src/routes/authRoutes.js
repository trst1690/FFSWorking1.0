// backend/src/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../models');

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide all required fields'
      });
    }
    
    // Check if user exists
    const existingUser = await db.User.findOne({
      where: {
        [db.Sequelize.Op.or]: [{ email }, { username }]
      }
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User already exists with that email or username'
      });
    }
    
    // Create user (password will be hashed by the model hook)
    const user = await db.User.create({
      username,
      email,
      password
    });
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.status(201).json({
      success: true,
      token,
      user: user.toJSON()
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register user'
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, username, password } = req.body;
    
    // Accept either email or username
    const loginField = email || username;
    
    if (!loginField || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide email/username and password'
      });
    }
    
    // Find user by email or username
    const whereClause = email 
      ? { email: email.toLowerCase() }
      : { username: username.toLowerCase() };
    
    const user = await db.User.findOne({
      where: whereClause
    });
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    // Check password
    const isValid = await user.validatePassword(password);
    
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
    
    // Update last login
    user.last_login = new Date();
    await user.save();
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: user.toJSON()
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to login'
    });
  }
});

// Verify token endpoint
router.get('/verify', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await db.User.findByPk(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: user.toJSON()
    });
    
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
});

module.exports = router;