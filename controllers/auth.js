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
  console.log('🔐 LOGIN ATTEMPT:', {
    username: req.body.username,
    hasPassword: !!req.body.password,
    timestamp: new Date().toISOString()
  });

  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ LOGIN VALIDATION FAILED:', errors.array());
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { username, password } = req.body;
    console.log('📝 LOGIN PARAMS:', { username, passwordLength: password.length });

    // Find user
    console.log('🔍 QUERYING DATABASE for user:', username);
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, password_hash, is_active')
      .or(`username.eq.${username},email.eq.${username}`)
      .single();

    console.log('📊 DATABASE RESULT:', {
      hasData: !!user,
      hasError: !!userError,
      userFound: user ? {
        id: user.id,
        username: user.username,
        is_active: user.is_active,
        hasPasswordHash: !!user.password_hash
      } : null,
      errorMessage: userError?.message
    });

    if (userError || !user) {
      console.log('❌ USER NOT FOUND:', username);
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid username or password'
        }
      });
    }

    if (!user.is_active) {
      console.log('🚫 USER INACTIVE:', user.id);
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Account is deactivated'
        }
      });
    }

    // Verify password
    console.log('🔑 VERIFYING PASSWORD for user:', user.id);
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    console.log('🔐 PASSWORD VERIFICATION:', {
      isValid: isValidPassword,
      hashLength: user.password_hash.length,
      providedPasswordLength: password.length
    });

    if (!isValidPassword) {
      console.log('❌ INVALID PASSWORD for user:', user.id);
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid username or password'
        }
      });
    }

    // Update last login
    console.log('📅 UPDATING LAST LOGIN for user:', user.id);
    const { error: updateError } = await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    if (updateError) {
      console.log('⚠️ LAST LOGIN UPDATE FAILED (non-critical):', updateError.message);
      // Don't fail login for this, just log it
    } else {
      console.log('✅ LAST LOGIN UPDATED for user:', user.id);
    }

    // Generate tokens
    console.log('🎫 GENERATING TOKENS for user:', user.id);
    const accessToken = generateAccessToken(user.id);
    const refreshToken = generateRefreshToken(user.id);

    console.log('✅ LOGIN SUCCESSFUL for user:', username);

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
    console.error('💥 LOGIN ERROR:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      detail: err.detail,
      hint: err.hint
    });
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
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, email, is_active')
      .eq('id', decoded.userId)
      .single();

    if (userError || !user || !user.is_active) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not found or deactivated'
        }
      });
    }

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
