// backend/src/controllers/marketMoverController.js
const marketMoverService = require('../services/marketMoverService');
const ticketService = require('../services/ticketService');
const contestService = require('../services/contestService');

const getVoteLeaders = async (req, res) => {
  try {
    const leaders = await marketMoverService.getVoteLeaders();
    res.json({
      success: true,
      leaders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const getBidUpPlayer = async (req, res) => {
  try {
    const bidUpPlayer = await marketMoverService.getBidUpPlayer();
    res.json({
      success: true,
      player: bidUpPlayer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const getCircuitBreakerList = async (req, res) => {
  try {
    const players = await marketMoverService.getCircuitBreakerList();
    res.json({
      success: true,
      players
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const voteForPlayer = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const { playerId } = req.body;
    
    if (!playerId) {
      return res.status(400).json({
        success: false,
        error: 'Player ID required'
      });
    }
    
    // Check if user has tickets
    const ticketBalance = await ticketService.getBalance(userId);
    if (ticketBalance < 1) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient tickets'
      });
    }
    
    // Process vote
    const voteCount = await marketMoverService.voteForPlayer(userId, playerId);
    
    res.json({
      success: true,
      voteCount,
      message: 'Vote recorded successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const checkOwnership = async (req, res) => {
  try {
    const userId = req.user.id || req.user.userId;
    const { contestId, playerName } = req.body;
    
    if (!contestId || !playerName) {
      return res.status(400).json({
        success: false,
        error: 'Contest ID and player name required'
      });
    }
    
    // Check if user has tickets
    const ticketBalance = await ticketService.getBalance(userId);
    if (ticketBalance < 1) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient tickets'
      });
    }
    
    // Use ticket
    await ticketService.useTickets(userId, 1, `Ownership check: ${playerName}`);
    
    // Calculate ownership
    const ownership = await contestService.calculateOwnership(contestId, playerName);
    
    res.json({
      success: true,
      ownership,
      playerName,
      contestId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

const getActiveMMContests = async (req, res) => {
  try {
    const contests = await contestService.getContests();
    const mmContests = contests.filter(c => c.type === 'market' && c.status === 'open');
    
    res.json({
      success: true,
      contests: mmContests
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getVoteLeaders,
  getBidUpPlayer,
  getCircuitBreakerList,
  voteForPlayer,
  checkOwnership,
  getActiveMMContests
};