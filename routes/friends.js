const express = require('express');
const router = express.Router();
const {
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  removeFriend,
  getPendingRequests,
  getSentRequests,
  getFriendList,
  getOnlineFriends,
  inviteFriendToGame,
  blockUser,
  sendFriendRequestValidation,
  respondFriendRequestValidation,
  inviteFriendToGameValidation
} = require('../controllers/friends');
const { authenticateToken } = require('../middleware/auth');

/**
 * Friend management routes for social connections
 */

// Send friend request (requires authentication)
router.post('/request', authenticateToken, sendFriendRequestValidation, sendFriendRequest);

// Accept friend request (requires authentication)
router.post('/accept', authenticateToken, respondFriendRequestValidation, acceptFriendRequest);

// Decline friend request (requires authentication)
router.post('/decline', authenticateToken, respondFriendRequestValidation, declineFriendRequest);

// Remove friend (requires authentication)
router.delete('/remove/:friendId', authenticateToken, removeFriend);

// Get pending friend requests (received) (requires authentication)
router.get('/requests/pending', authenticateToken, getPendingRequests);

// Get sent friend requests (requires authentication)
router.get('/requests/sent', authenticateToken, getSentRequests);

// Get friend list (requires authentication)
router.get('/list', authenticateToken, getFriendList);

// Get online friends only (requires authentication)
router.get('/online', authenticateToken, getOnlineFriends);

// Send game invitation to friend (requires authentication)
router.post('/invite', authenticateToken, inviteFriendToGameValidation, inviteFriendToGame);

// Block user (placeholder - requires authentication)
router.post('/block/:userId', authenticateToken, blockUser);

module.exports = router;
