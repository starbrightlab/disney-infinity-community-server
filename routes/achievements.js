/**
 * Achievement Routes
 * API endpoints for achievement system
 */

const express = require('express');
const router = express.Router();
const {
  getAchievements,
  getPlayerAchievements,
  getAchievementNotifications,
  markNotificationsRead,
  triggerAchievementCheck,
  getAchievementLeaderboard
} = require('../controllers/achievements');

// Achievement browsing
router.get('/', getAchievements);

// Player achievements
router.get('/player/:userId?', getPlayerAchievements);

// Achievement notifications
router.get('/notifications', getAchievementNotifications);
router.put('/notifications/read', markNotificationsRead);

// Achievement leaderboard
router.get('/leaderboard', getAchievementLeaderboard);

// Admin/Debug endpoints
router.post('/check', triggerAchievementCheck); // Manual achievement check

module.exports = router;
