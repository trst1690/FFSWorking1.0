// backend/src/routes/marketMoverRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const marketMoverService = require('../services/marketMoverService');
const db = require('../models');

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Get current status
router.get('/status', async (req, res) => {
  try {
    const status = marketMoverService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Vote for a player
router.post('/vote', authenticateToken, async (req, res) => {
  try {
    const { playerName, playerId, ticketsToUse = 1 } = req.body;
    const userId = req.user.id || req.user.userId;
    
    if (!playerName) {
      return res.status(400).json({ error: 'Player name is required' });
    }
    
    if (ticketsToUse < 1) {
      return res.status(400).json({ error: 'Must use at least 1 ticket' });
    }
    
    // Check if user has enough tickets
    const user = await db.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.tickets < ticketsToUse) {
      return res.status(400).json({ error: 'Insufficient tickets' });
    }
    
    // Deduct tickets
    await user.update({ tickets: user.tickets - ticketsToUse });
    
    // Create ticket transaction with a valid enum value
    // Check what enum values are valid in your database
    // Common values might be: 'purchase', 'use', 'earned', 'other'
    if (db.TicketTransaction) {
      try {
        await db.TicketTransaction.create({
          user_id: userId,
          type: 'use', // Change this to match your enum: 'use', 'purchase', 'other', etc.
          amount: -ticketsToUse,
          description: `Vote for ${playerName} in Market Mover`,
          created_at: new Date()
        });
      } catch (txError) {
        console.error('Error creating ticket transaction:', txError);
        // Continue even if transaction logging fails
      }
    }
    
    // Record the vote
    if (db.MarketMoverVote) {
      await db.MarketMoverVote.create({
        user_id: userId,
        player_name: playerName,
        player_id: playerId,
        vote_time: new Date()
      });
    } else {
      // If MarketMoverVote model doesn't exist, use the service
      await marketMoverService.voteForPlayer(userId, playerName, ticketsToUse);
    }
    
    res.json({ 
      success: true,
      message: `Vote submitted for ${playerName}`,
      newTickets: user.tickets - ticketsToUse
    });
  } catch (error) {
    console.error('Error voting for player:', error);
    res.status(400).json({ error: error.message });
  }
});

// Check player ownership percentage
router.post('/ownership', authenticateToken, async (req, res) => {
  try {
    const { contestId, playerName } = req.body;
    const userId = req.user.id || req.user.userId;
    
    if (!contestId || !playerName) {
      return res.status(400).json({ error: 'Contest ID and player name are required' });
    }
    
    // Check if user has tickets
    const user = await db.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (user.tickets < 1) {
      return res.status(400).json({ error: 'Insufficient tickets' });
    }
    
    // Deduct 1 ticket
    await user.update({ tickets: user.tickets - 1 });
    
    // Log ticket transaction
    if (db.TicketTransaction) {
      try {
        await db.TicketTransaction.create({
          user_id: userId,
          type: 'use', // Use a valid enum value
          amount: -1,
          description: `Check ownership for ${playerName}`,
          created_at: new Date()
        });
      } catch (txError) {
        console.error('Error creating ticket transaction:', txError);
      }
    }
    
    // Calculate ownership percentage
    const totalEntries = await db.Entry.count({
      where: { 
        contest_id: contestId,
        status: 'completed'
      }
    });
    
    if (totalEntries === 0) {
      return res.json({ 
        ownership: 0,
        message: 'No completed entries in this contest yet',
        newTickets: user.tickets - 1
      });
    }
    
    // Count entries that have this player
    const entriesWithPlayer = await db.Entry.count({
      where: {
        contest_id: contestId,
        status: 'completed',
        [db.Sequelize.Op.or]: [
          { 'roster.QB.name': playerName },
          { 'roster.RB.name': playerName },
          { 'roster.WR.name': playerName },
          { 'roster.TE.name': playerName },
          { 'roster.FLEX.name': playerName }
        ]
      }
    });
    
    const ownership = (entriesWithPlayer / totalEntries) * 100;
    
    res.json({ 
      ownership: ownership.toFixed(2),
      totalEntries,
      entriesWithPlayer,
      newTickets: user.tickets - 1
    });
  } catch (error) {
    console.error('Error checking ownership:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active Market Mover contests
router.get('/active-contests', authenticateToken, async (req, res) => {
  try {
    const contests = await db.Contest.findAll({
      where: {
        type: 'market',
        status: ['open', 'active', 'in_progress']
      },
      attributes: ['id', 'name', 'current_entries', 'max_entries'],
      order: [['created_at', 'DESC']]
    });
    
    res.json({ 
      contests: contests.map(c => ({
        id: c.id,
        name: c.name,
        currentEntries: c.current_entries || 0,
        maxEntries: c.max_entries || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching active contests:', error);
    res.status(500).json({ error: 'Failed to fetch active contests' });
  }
});

// Get voting results
router.get('/results', async (req, res) => {
  try {
    const results = await marketMoverService.getVotingResults();
    res.json({ results });
  } catch (error) {
    console.error('Error getting results:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's voting history
router.get('/my-votes', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    
    // Check if the model exists before querying
    if (!db.MarketMoverVote) {
      return res.json({ votes: [] });
    }
    
    const votes = await db.MarketMoverVote.findAll({
      where: { user_id: userId },
      order: [['vote_time', 'DESC']],
      limit: 50
    });
    
    res.json({ 
      votes: votes.map(v => ({
        playerName: v.player_name,
        voteTime: v.vote_time
      }))
    });
  } catch (error) {
    console.error('Error getting user votes:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;