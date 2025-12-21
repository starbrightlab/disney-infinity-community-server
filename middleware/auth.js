const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const winston = require('winston');

/**
 * Authentication middleware
 */

/**
 * Verify JWT token and attach user to request
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token required'
        }
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database to ensure they still exist and are active
    const userResult = await query(
      'SELECT id, username, email, is_admin, is_moderator, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not found'
        }
      });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Account is deactivated'
        }
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      isAdmin: user.is_admin,
      isModerator: user.is_moderator
    };

    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid token'
        }
      });
    }

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token expired'
        }
      });
    }

    winston.error('Authentication error:', err);
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Authentication failed'
      }
    });
  }
};

/**
 * Require admin role
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required'
      }
    });
  }
  next();
};

/**
 * Require moderator role (admin or moderator)
 */
const requireModerator = (req, res, next) => {
  if (!req.user || (!req.user.isAdmin && !req.user.isModerator)) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Moderator access required'
      }
    });
  }
  next();
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const userResult = await query(
      'SELECT id, username, email, is_admin, is_moderator, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length > 0 && userResult.rows[0].is_active) {
      const user = userResult.rows[0];
      req.user = {
        id: user.id,
        username: user.username,
        email: user.email,
        isAdmin: user.is_admin,
        isModerator: user.is_moderator
      };
    } else {
      req.user = null;
    }

    next();
  } catch (err) {
    // For optional auth, we don't fail on errors - just set user to null
    req.user = null;
    next();
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
  requireModerator,
  optionalAuth
};
