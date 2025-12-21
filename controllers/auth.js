const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/database');
const { body, validationResult } = require('express-validator');
const winston = require('winston');

/**
 * Authentication controller
 */

/**
 * Generate access token
 */
const generateAccessToken = (userId) => {
  return jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
};

/**
 * Generate refresh token
 */
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

/**
 * User registration validation
 */
const registerValidation = [
  body('username')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
];

/**
 * User registration
 */
const register = async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { username, email, password } = req.body;

    // Check if user already exists
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('id')
      .or(`username.eq.${username},email.eq.${email}`);

    if (checkError) {
      winston.error('Error checking existing user:', checkError);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to check existing user'
        }
      });
    }

    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({
        error: {
          code: 'CONFLICT',
          message: 'Username or email already exists'
        }
      });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user
    const { data: user, error: insertError } = await supabase
      .from('users')
      .insert([{
        username,
        email,
        password_hash: passwordHash,
        profile_data: { display_name: username }
      }])
      .select('id, username, email, created_at')
      .single();

    if (insertError) {
      winston.error('Error creating user:', insertError);
      return res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create user'
        }
      });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    winston.info(`User registered: ${username} (${user.id})`);

    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      created_at: user.created_at,
      token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600 // 1 hour
    });

  } catch (err) {
    winston.error('Registration error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Registration failed'
      }
    });
  }
};

/**
 * User login validation
 */
const loginValidation = [
  body('username').notEmpty().withMessage('Username required'),
  body('password').notEmpty().withMessage('Password required')
];

/**
 * User login
 */
const login = async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { username, password } = req.body;

    // Find user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, password_hash, is_active')
      .or(`username.eq.${username},email.eq.${username}`)
      .single();

    if (userError || !user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid username or password'
        }
      });
    }

    if (!user.is_active) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Account is deactivated'
        }
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid username or password'
        }
      });
    }

    // Update last login
    await query(
      'UPDATE users SET last_login = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate tokens
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    winston.info(`User logged in: ${username} (${user.id})`);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600 // 1 hour
    });

  } catch (err) {
    winston.error('Login error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Login failed'
      }
    });
  }
};

/**
 * Refresh access token
 */
const refresh = async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const refreshToken = authHeader && authHeader.split(' ')[1];

    if (!refreshToken) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Refresh token required'
        }
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );

    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid refresh token'
        }
      });
    }

    // Check if user still exists and is active
    const result = await query(
      'SELECT id, username, email, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not found or deactivated'
        }
      });
    }

    const user = result.rows[0];

    // Generate new tokens
    const accessToken = generateAccessToken(user.id);
    const newRefreshToken = generateRefreshToken(user.id);

    winston.debug(`Token refreshed for user: ${user.username} (${user.id})`);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token: accessToken,
      refresh_token: newRefreshToken,
      expires_in: 3600 // 1 hour
    });

  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired refresh token'
        }
      });
    }

    winston.error('Token refresh error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Token refresh failed'
      }
    });
  }
};

module.exports = {
  register,
  login,
  refresh,
  registerValidation,
  loginValidation
};
