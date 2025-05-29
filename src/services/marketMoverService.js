// backend/src/services/marketMoverService.js
const db = require('../models');
const { Op } = require('sequelize');

class MarketMoverService {
  constructor() {
    this.bidUpPlayer = null;
    this.bidUpStartTime = null;
    this.bidUpDuration = 15 * 60 * 1000; // 15 minutes
    this.circuitBreakerDuration = 6 * 60 * 60 * 1000; // 6 hours
    this.circuitBreakerList = new Map(); // playerName -> endTime
    this.votingPeriodDuration = 60 * 60 * 1000; // 60 minutes
    this.currentVotingPeriodStart = Date.now();
  }

  // Initialize or restore state
  async initialize() {
    try {
      const db = require('../models');
      
      // Check if the model exists before trying to use it
      if (db.MarketMoverBidUp) {
        // Restore bid up player from database if server restarted
        const activeBidUp = await db.MarketMoverBidUp.findOne({
          where: {
            end_time: {
              [Op.gt]: new Date()
            }
          },
          order: [['created_at', 'DESC']]
        });

        if (activeBidUp) {
          this.bidUpPlayer = activeBidUp.player_name;
          this.bidUpStartTime = new Date(activeBidUp.start_time);
          console.log(`Restored active bid up player: ${this.bidUpPlayer}`);
        }
      }

      // Check if circuit breaker model exists
      if (db.MarketMoverCircuitBreaker) {
        // Restore circuit breaker list
        const circuitBreakerPlayers = await db.MarketMoverCircuitBreaker.findAll({
          where: {
            end_time: {
              [Op.gt]: new Date()
            }
          }
        });

        circuitBreakerPlayers.forEach(cb => {
          this.circuitBreakerList.set(cb.player_name, new Date(cb.end_time));
        });

        console.log(`Restored ${circuitBreakerPlayers.length} players in circuit breaker`);
      }
    } catch (error) {
      console.log('Market Mover tables not yet created, will initialize empty');
    }
  }

  // Get current status
  getStatus() {
    const now = Date.now();
    let bidUpTimeRemaining = 0;
    let bidUpPercentage = 35; // Default boost percentage

    if (this.bidUpPlayer && this.bidUpStartTime) {
      const elapsed = now - new Date(this.bidUpStartTime).getTime();
      const remaining = this.bidUpDuration - elapsed;
      
      if (remaining > 0) {
        bidUpTimeRemaining = Math.floor(remaining / 1000); // seconds
      } else {
        // Bid up period ended, move to circuit breaker
        this.moveToCircuitBreaker(this.bidUpPlayer);
        this.bidUpPlayer = null;
        this.bidUpStartTime = null;
      }
    }

    // Clean expired circuit breakers
    this.cleanExpiredCircuitBreakers();

    // Calculate voting period time remaining
    const votingElapsed = now - this.currentVotingPeriodStart;
    const votingRemaining = Math.max(0, this.votingPeriodDuration - votingElapsed);

    return {
      votingActive: true,
      votingTimeRemaining: Math.floor(votingRemaining / 1000), // seconds
      bidUpPlayer: this.bidUpPlayer,
      bidUpTimeRemaining,
      bidUpPercentage,
      circuitBreakerList: Array.from(this.circuitBreakerList.keys()),
      message: 'Market Mover voting is open'
    };
  }

  // Vote for a player
  async voteForPlayer(userId, playerName, ticketsToUse = 1) {
    const transaction = await db.sequelize.transaction();
    
    try {
      // Check if player is currently bid up
      if (this.bidUpPlayer === playerName) {
        throw new Error(`${playerName} is currently bid up and cannot receive more votes`);
      }

      // Check if player is in circuit breaker
      if (this.isInCircuitBreaker(playerName)) {
        const endTime = this.circuitBreakerList.get(playerName);
        const hoursRemaining = Math.ceil((endTime - Date.now()) / (1000 * 60 * 60));
        throw new Error(`${playerName} is in circuit breaker for ${hoursRemaining} more hours`);
      }

      // Get user and verify tickets
      const user = await db.User.findByPk(userId, { transaction });
      if (!user) {
        throw new Error('User not found');
      }
      
      if (user.tickets < ticketsToUse) {
        throw new Error(`Insufficient tickets. You have ${user.tickets} but need ${ticketsToUse}`);
      }
      
      // Deduct tickets
      user.tickets -= ticketsToUse;
      await user.save({ transaction });
      
      // Create ticket transaction record
      await db.TicketTransaction.create({
        user_id: userId,
        type: 'use',
        amount: -ticketsToUse,
        balance_after: user.tickets,
        reason: `Voted ${ticketsToUse} times for ${playerName} in Market Mover`
      }, { transaction });
      
      // Record the votes - check if model exists
      if (db.MarketMoverVote) {
        for (let i = 0; i < ticketsToUse; i++) {
          await db.MarketMoverVote.create({
            user_id: userId,
            player_name: playerName,
            vote_time: new Date(),
            voting_period_start: new Date(this.currentVotingPeriodStart)
          }, { transaction });
        }
      }
      
      await transaction.commit();
      
      // Get updated vote count for this voting period
      const voteCount = await this.getVoteCount(playerName);
      
      // Check if this player should become bid up
      await this.checkForNewBidUp();
      
      return {
        success: true,
        playerName,
        ticketsUsed: ticketsToUse,
        newTicketBalance: user.tickets,
        totalVotes: voteCount
      };
      
    } catch (error) {
      await transaction.rollback();
      console.error('Error voting for player:', error);
      throw error;
    }
  }

  // Get vote count for current voting period
  async getVoteCount(playerName) {
    if (!db.MarketMoverVote) return 0;
    
    return await db.MarketMoverVote.count({
      where: {
        player_name: playerName,
        voting_period_start: {
          [Op.gte]: new Date(this.currentVotingPeriodStart)
        }
      }
    });
  }

  // Get current voting results
  async getVotingResults() {
    try {
      if (!db.MarketMoverVote) return [];
      
      const results = await db.MarketMoverVote.findAll({
        attributes: [
          'player_name',
          [db.sequelize.fn('COUNT', db.sequelize.col('player_name')), 'votes']
        ],
        where: {
          voting_period_start: {
            [Op.gte]: new Date(this.currentVotingPeriodStart)
          }
        },
        group: ['player_name'],
        order: [[db.sequelize.fn('COUNT', db.sequelize.col('player_name')), 'DESC']],
        limit: 20
      });
      
      return results.map(r => ({
        playerName: r.player_name,
        votes: parseInt(r.dataValues.votes),
        isBidUp: r.player_name === this.bidUpPlayer,
        isCircuitBreaker: this.isInCircuitBreaker(r.player_name)
      }));
    } catch (error) {
      console.error('Error getting voting results:', error);
      return [];
    }
  }

  // Check if we need a new bid up player
  async checkForNewBidUp() {
    // Only set new bid up if we don't have one
    if (this.bidUpPlayer) return;

    const results = await this.getVotingResults();
    if (results.length === 0) return;

    // Find the highest voted player not in circuit breaker
    for (const result of results) {
      if (!this.isInCircuitBreaker(result.playerName) && result.votes >= 1) {
        await this.setBidUpPlayer(result.playerName);
        break;
      }
    }
  }

  // Set a player as bid up
  async setBidUpPlayer(playerName) {
    this.bidUpPlayer = playerName;
    this.bidUpStartTime = new Date();

    // Save to database if model exists
    try {
      const db = require('../models');
      if (db.MarketMoverBidUp) {
        await db.MarketMoverBidUp.create({
          player_name: playerName,
          start_time: this.bidUpStartTime,
          end_time: new Date(Date.now() + this.bidUpDuration),
          boost_percentage: 35
        });
      }
    } catch (error) {
      console.log('Could not save bid up to database:', error.message);
    }

    // Start new voting period
    this.currentVotingPeriodStart = Date.now();

    // Clear all votes from previous period
    console.log(`${playerName} is now bid up with 35% boost for 15 minutes`);
  }

  // Move player to circuit breaker
  async moveToCircuitBreaker(playerName) {
    const endTime = new Date(Date.now() + this.circuitBreakerDuration);
    this.circuitBreakerList.set(playerName, endTime);

    // Save to database if model exists
    try {
      const db = require('../models');
      if (db.MarketMoverCircuitBreaker) {
        await db.MarketMoverCircuitBreaker.create({
          player_name: playerName,
          start_time: new Date(),
          end_time: endTime
        });
      }
    } catch (error) {
      console.log('Could not save circuit breaker to database:', error.message);
    }

    console.log(`${playerName} moved to circuit breaker until ${endTime}`);
  }

  // Check if player is in circuit breaker
  isInCircuitBreaker(playerName) {
    const endTime = this.circuitBreakerList.get(playerName);
    if (!endTime) return false;
    
    if (Date.now() > endTime) {
      this.circuitBreakerList.delete(playerName);
      return false;
    }
    
    return true;
  }

  // Clean expired circuit breakers
  cleanExpiredCircuitBreakers() {
    const now = Date.now();
    for (const [playerName, endTime] of this.circuitBreakerList) {
      if (now > endTime) {
        this.circuitBreakerList.delete(playerName);
      }
    }
  }

  // Get player boost percentage (for draft board display)
  getPlayerBoost(playerName) {
    if (this.bidUpPlayer === playerName) {
      return 35; // 35% appearance boost
    }
    return 0;
  }

  // Process voting period end (called by cron job or timer)
  async processVotingPeriodEnd() {
    // If no bid up player, select the winner
    if (!this.bidUpPlayer) {
      await this.checkForNewBidUp();
    }
    
    // Reset for next period will happen when bid up expires
  }

  // Calculate ownership percentage for a player in a contest
  async calculateOwnership(contestId, playerName) {
    try {
      const db = require('../models');
      
      // Get all completed entries for this contest
      const entries = await db.ContestEntry.findAll({
        where: {
          contest_id: contestId,
          status: 'completed'
        },
        attributes: ['roster']
      });
      
      if (entries.length === 0) {
        return 0;
      }
      
      // Count how many rosters contain this player
      let count = 0;
      entries.forEach(entry => {
        const roster = entry.roster || {};
        // Check all roster positions
        for (const position in roster) {
          if (roster[position] && roster[position].name === playerName) {
            count++;
            break; // Only count once per roster
          }
        }
      });
      
      // Calculate percentage
      const ownership = (count / entries.length) * 100;
      return Math.round(ownership * 10) / 10; // Round to 1 decimal place
    } catch (error) {
      console.error('Error calculating ownership:', error);
      return 0;
    }
  }
}

module.exports = new MarketMoverService();