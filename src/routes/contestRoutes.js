// backend/src/routes/contestRoutes.js - Fixed version
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const db = require('../models');
const { Contest, ContestEntry, User, DraftPick, Transaction } = db;
const { v4: uuidv4 } = require('uuid');
const contestService = require('../services/contestService');

// Log middleware for debugging
router.use((req, res, next) => {
  console.log(`Contest Route: ${req.method} ${req.path}`);
  next();
});

// ==================== PUBLIC ROUTES (NO AUTH REQUIRED) ====================

// Test route to verify routes are loaded
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Contest routes are working!',
    timestamp: new Date().toISOString()
  });
});

// Get all active contests - PUBLIC ROUTE (NO AUTH)
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all contests...');
    
    // Use contestService to get contests
    const contests = await contestService.getContests();
    
    console.log(`Returning ${contests.length} contests`);
    res.json(contests);
    
  } catch (error) {
    console.error('Get contests error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch contests',
      message: error.message 
    });
  }
});

// Get single contest details - PUBLIC ROUTE
router.get('/contest/:contestId', async (req, res) => {
  try {
    const { contestId } = req.params;
    console.log('Fetching contest:', contestId);
    
    const contest = await contestService.getContest(contestId);
    
    if (!contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }
    
    // Get entries if needed
    const entries = await ContestEntry.findAll({
      where: {
        contest_id: contest.id,
        status: {
          [db.Sequelize.Op.in]: ['pending', 'drafting', 'completed']
        }
      },
      include: [{
        model: User,
        attributes: ['id', 'username']
      }]
    });
    
    const formattedContest = {
      ...contest,
      entries: entries.map(e => ({
        id: e.id,
        userId: e.user_id,
        username: e.User?.username || 'Unknown',
        status: e.status,
        draftRoomId: e.draft_room_id
      }))
    };
    
    res.json(formattedContest);
    
  } catch (error) {
    console.error('Get contest error:', error);
    res.status(500).json({ error: 'Failed to fetch contest' });
  }
});

// Get room status
router.get('/room/:roomId/status', async (req, res) => {
  try {
    const { roomId } = req.params;
    const roomStatus = await contestService.getRoomStatus(roomId);
    
    if (!roomStatus) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    res.json(roomStatus);
  } catch (error) {
    console.error('Get room status error:', error);
    res.status(500).json({ error: 'Failed to get room status' });
  }
});

// ==================== AUTHENTICATED ROUTES ====================

// Get user's contest entries
router.get('/my-entries', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    console.log('Fetching entries for user:', userId);
    
    const entries = await contestService.getUserEntries(userId);
    
    console.log(`Found ${entries.length} entries for user`);
    res.json(entries);
    
  } catch (error) {
    console.error('Get user entries error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch entries',
      message: error.message 
    });
  }
});

// Enter a contest - USING CONTEST SERVICE
router.post('/enter/:contestId', authMiddleware, async (req, res) => {
  try {
    const { contestId } = req.params;
    const userId = req.user.id || req.user.userId;
    const username = req.user.username || 'Player';
    
    console.log(`Processing entry request: User ${userId} -> Contest ${contestId}`);
    
    // Use contest service to handle entry
    const result = await contestService.enterContest(contestId, userId, username);
    
    // Emit socket events for room update
    const io = req.app.get('io');
    if (io && result.draftRoomId) {
      // Join user to room
      io.to(`user_${userId}`).emit('joined-room', {
        roomId: result.draftRoomId,
        contestId: contestId
      });
      
      // Notify others in room
      io.to(`room_${result.draftRoomId}`).emit('user-joined', {
        userId,
        username,
        roomId: result.draftRoomId
      });
    }
    
    res.json(result);
    
  } catch (error) {
    console.error('Enter contest error:', error);
    res.status(400).json({ 
      error: error.message || 'Failed to enter contest' 
    });
  }
});

// Withdraw from contest
router.post('/withdraw/:entryId', authMiddleware, async (req, res) => {
  try {
    const { entryId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    const result = await contestService.withdrawEntry(entryId, userId);
    
    res.json(result);
    
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Save draft pick
router.post('/draft/:entryId/pick', authMiddleware, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { player, position } = req.body;
    const userId = req.user.id || req.user.userId;
    
    // Verify user owns this entry
    const entry = await contestService.getEntry(entryId);
    if (!entry || entry.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Handle the pick through contest service
    await contestService.handlePlayerPick(entry.draftRoomId, userId, player, position);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Draft pick error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Complete draft
router.post('/draft/:entryId/complete', authMiddleware, async (req, res) => {
  try {
    const { entryId } = req.params;
    const { roster, totalSpent } = req.body;
    const userId = req.user.id || req.user.userId;
    
    // Verify user owns this entry
    const entry = await contestService.getEntry(entryId);
    if (!entry || entry.userId !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const result = await contestService.completeDraft(entryId, roster, totalSpent);
    
    res.json({ 
      success: true,
      message: 'Draft completed successfully'
    });
    
  } catch (error) {
    console.error('Complete draft error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get user's contest history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    
    const history = await contestService.getUserContestHistory(userId, limit);
    
    res.json(history);
  } catch (error) {
    console.error('Get history error:', error);
    res.status(500).json({ error: 'Failed to fetch contest history' });
  }
});

// ==================== SOCKET INTEGRATION ROUTES ====================

// Join contest lobby (for real-time updates)
router.post('/:contestId/join-lobby', authMiddleware, async (req, res) => {
  try {
    const { contestId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('join-contest-lobby', { contestId });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join lobby' });
  }
});

// Leave contest lobby
router.post('/:contestId/leave-lobby', authMiddleware, async (req, res) => {
  try {
    const { contestId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${userId}`).emit('leave-contest-lobby', { contestId });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to leave lobby' });
  }
});

// ==================== MARKET MOVER ROUTES ====================

// Calculate ownership for Market Mover
router.post('/:contestId/ownership', authMiddleware, async (req, res) => {
  try {
    const { contestId } = req.params;
    const { playerName } = req.body;
    const userId = req.user.id || req.user.userId;
    
    // Check if user has tickets
    const user = await User.findByPk(userId);
    if (!user || user.tickets < 1) {
      return res.status(400).json({ error: 'Insufficient tickets' });
    }
    
    // Calculate ownership
    const ownership = await contestService.calculateOwnership(contestId, playerName);
    
    // Deduct ticket
    await user.decrement('tickets', { by: 1 });
    
    res.json({
      success: true,
      ownership,
      playerName,
      remainingTickets: user.tickets - 1
    });
    
  } catch (error) {
    console.error('Ownership calculation error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== ADMIN/DEBUG ROUTES ====================

// Health check
router.get('/health', async (req, res) => {
  try {
    const health = await contestService.healthCheck();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

// Ensure cash game available
router.post('/ensure-cash-game', async (req, res) => {
  try {
    await contestService.ensureCashGameAvailable();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Debug route to see all contests
router.get('/debug/all', async (req, res) => {
  try {
    const contests = await contestService.getAllContests(true);
    res.json({ 
      count: contests.length,
      contests 
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create test contest
router.post('/debug/create-test-contest', async (req, res) => {
  try {
    const { generatePlayerBoard } = require('../utils/gameLogic');
    
    const contest = await Contest.create({
      name: `Test Contest ${Date.now()}`,
      type: 'cash',
      status: 'open',
      entry_fee: 0,
      max_entries: 2, // Only 2 for quick testing
      current_entries: 0,
      prize_pool: 10,
      prizes: [10],
      max_entries_per_user: 1,
      player_board: generatePlayerBoard('cash'),
      start_time: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    });
    
    res.json({
      success: true,
      contest: {
        id: contest.id,
        name: contest.name,
        type: contest.type
      }
    });
  } catch (error) {
    console.error('Create test contest error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Force launch draft (admin only)
router.post('/debug/launch-draft/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    
    const roomStatus = await contestService.getRoomStatus(roomId);
    if (!roomStatus) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    const contest = await Contest.findByPk(roomStatus.contestId);
    await contestService.launchDraft(roomId, roomStatus, contest);
    
    res.json({ 
      success: true,
      message: 'Draft launched'
    });
  } catch (error) {
    console.error('Force launch error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;