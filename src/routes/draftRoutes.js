// backend/src/routes/draftRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const contestService = require('../services/contestService');
const db = require('../models');

// Get draft status
router.get('/:draftId/status', authMiddleware, async (req, res) => {
  try {
    const { draftId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    // Get draft/room status
    const roomStatus = await contestService.getRoomStatus(draftId);
    
    if (!roomStatus) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    
    // Check if user is part of this draft
    const isParticipant = roomStatus.entries.some(e => e.userId === userId);
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this draft' });
    }
    
    res.json(roomStatus);
    
  } catch (error) {
    console.error('Get draft status error:', error);
    res.status(500).json({ error: 'Failed to get draft status' });
  }
});

// Get user's active drafts
router.get('/active', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    
    const activeEntries = await db.ContestEntry.findAll({
      where: {
        user_id: userId,
        status: { [db.Sequelize.Op.in]: ['pending', 'drafting'] }
      },
      include: [{
        model: db.Contest,
        attributes: ['id', 'name', 'type', 'player_board']
      }]
    });
    
    const activeDrafts = activeEntries.map(entry => ({
      entryId: entry.id,
      contestId: entry.contest_id,
      contestName: entry.Contest?.name,
      contestType: entry.Contest?.type,
      draftRoomId: entry.draft_room_id,
      status: entry.status,
      enteredAt: entry.entered_at
    }));
    
    res.json(activeDrafts);
    
  } catch (error) {
    console.error('Get active drafts error:', error);
    res.status(500).json({ error: 'Failed to get active drafts' });
  }
});

// Make a draft pick
router.post('/:draftId/pick', authMiddleware, async (req, res) => {
  try {
    const { draftId } = req.params;
    const { playerId, playerData, position } = req.body;
    const userId = req.user.id || req.user.userId;
    
    // Validate pick data
    if (!position || (!playerId && !playerData)) {
      return res.status(400).json({ 
        error: 'Missing required pick data' 
      });
    }
    
    // Process pick through contest service
    await contestService.handlePlayerPick(
      draftId, 
      userId, 
      playerData || { id: playerId }, 
      position
    );
    
    res.json({ 
      success: true,
      message: 'Pick recorded successfully'
    });
    
  } catch (error) {
    console.error('Make pick error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Auto-pick for user
router.post('/:draftId/auto-pick', authMiddleware, async (req, res) => {
  try {
    const { draftId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    // Trigger auto-pick
    await contestService.handleAutoPick(draftId, userId);
    
    res.json({ 
      success: true,
      message: 'Auto-pick triggered'
    });
    
  } catch (error) {
    console.error('Auto-pick error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get draft picks for a room
router.get('/:draftId/picks', authMiddleware, async (req, res) => {
  try {
    const { draftId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    // Get room status to verify user is participant
    const roomStatus = await contestService.getRoomStatus(draftId);
    
    if (!roomStatus) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    
    const isParticipant = roomStatus.entries.some(e => e.userId === userId);
    
    if (!isParticipant) {
      return res.status(403).json({ error: 'Not a participant in this draft' });
    }
    
    // Get all picks for this draft room
    const picks = await db.DraftPick.findAll({
      where: { draft_room_id: draftId },
      include: [{
        model: db.User,
        attributes: ['id', 'username']
      }],
      order: [['pick_number', 'ASC']]
    });
    
    const formattedPicks = picks.map(pick => ({
      id: pick.id,
      userId: pick.user_id,
      username: pick.User?.username,
      playerData: pick.player_data,
      rosterSlot: pick.roster_slot,
      pickNumber: pick.pick_number,
      isAutoPick: pick.is_auto_pick,
      pickTime: pick.created_at
    }));
    
    res.json(formattedPicks);
    
  } catch (error) {
    console.error('Get picks error:', error);
    res.status(500).json({ error: 'Failed to get picks' });
  }
});

// Get user's lineup for a draft
router.get('/:draftId/lineup/:userId', authMiddleware, async (req, res) => {
  try {
    const { draftId, userId: targetUserId } = req.params;
    const requestingUserId = req.user.id || req.user.userId;
    
    // Get the entry
    const entry = await db.ContestEntry.findOne({
      where: {
        draft_room_id: draftId,
        user_id: targetUserId
      }
    });
    
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    
    // Only allow viewing own lineup or if draft is completed
    if (targetUserId !== requestingUserId && entry.status !== 'completed') {
      return res.status(403).json({ error: 'Cannot view other lineups during draft' });
    }
    
    res.json({
      lineup: entry.lineup || [],
      roster: entry.roster || {},
      totalSpent: entry.total_spent || 0,
      status: entry.status
    });
    
  } catch (error) {
    console.error('Get lineup error:', error);
    res.status(500).json({ error: 'Failed to get lineup' });
  }
});

// Complete draft manually (in case of issues)
router.post('/:draftId/complete', authMiddleware, async (req, res) => {
  try {
    const { draftId } = req.params;
    const userId = req.user.id || req.user.userId;
    
    // Get user's entry for this draft
    const entry = await db.ContestEntry.findOne({
      where: {
        draft_room_id: draftId,
        user_id: userId,
        status: 'drafting'
      }
    });
    
    if (!entry) {
      return res.status(404).json({ error: 'Active draft entry not found' });
    }
    
    // Check if user has completed all picks
    const pickCount = await db.DraftPick.count({
      where: {
        entry_id: entry.id
      }
    });
    
    if (pickCount < 8) {
      return res.status(400).json({ 
        error: `Draft incomplete. You have ${pickCount}/8 picks.` 
      });
    }
    
    // Get all picks and build roster
    const picks = await db.DraftPick.findAll({
      where: { entry_id: entry.id },
      order: [['pick_number', 'ASC']]
    });
    
    const roster = {};
    const lineup = [];
    let totalSpent = 0;
    
    picks.forEach(pick => {
      roster[pick.roster_slot] = pick.player_data;
      lineup.push({
        player: pick.player_data,
        rosterSlot: pick.roster_slot
      });
      totalSpent += pick.player_data.salary || 0;
    });
    
    // Complete the draft
    await contestService.completeDraft(entry.id, roster, totalSpent);
    
    res.json({
      success: true,
      message: 'Draft completed successfully',
      totalSpent,
      pickCount: picks.length
    });
    
  } catch (error) {
    console.error('Complete draft error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Get draft timer status
router.get('/:draftId/timer', authMiddleware, async (req, res) => {
  try {
    const { draftId } = req.params;
    
    const activeDraft = contestService.activeDrafts.get(draftId);
    
    if (!activeDraft) {
      return res.status(404).json({ error: 'No active draft found' });
    }
    
    const draftOrder = contestService.createSnakeDraftOrder(activeDraft.participants.length);
    const currentPlayerIndex = draftOrder[activeDraft.picks.length] || 0;
    const currentPlayer = activeDraft.participants[currentPlayerIndex];
    
    res.json({
      currentPick: activeDraft.picks.length + 1,
      totalPicks: activeDraft.participants.length * 8,
      currentPlayer: currentPlayer ? {
        userId: currentPlayer.userId,
        username: currentPlayer.username
      } : null,
      timeRemaining: 30 // Always 30 seconds per pick
    });
    
  } catch (error) {
    console.error('Get timer error:', error);
    res.status(500).json({ error: 'Failed to get timer status' });
  }
});

module.exports = router;