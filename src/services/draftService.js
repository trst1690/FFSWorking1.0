// backend/src/services/draftService.js
const Redis = require('ioredis');

class DraftService {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      keyPrefix: 'draft:'
    });
    this.io = null;
  }
  
  setSocketIO(io) {
    this.io = io;
    console.log('Socket.IO instance set in DraftService');
  }
  
  async startDraft(contestId, entries, playerBoard) {
    const draftState = {
      contestId,
      playerBoard,
      entries,
      currentTurn: 0,
      draftOrder: this.createSnakeDraftOrder(entries.length),
      picks: [],
      teams: entries.map((entry, index) => ({
        entryId: entry.id,
        userId: entry.userId || entry.user_id,
        username: entry.username,
        color: this.getTeamColor(index),
        roster: {
          QB: null,
          RB: null,
          WR: null,
          TE: null,
          FLEX: null
        },
        budget: 15,
        bonus: 0
      })),
      startTime: new Date().toISOString(),
      status: 'active'
    };
    
    // Store in Redis with 24 hour expiry
    const key = `state:${contestId}`;
    await this.redis.set(key, JSON.stringify(draftState), 'EX', 86400);
    
    // Also store a quick lookup for active drafts
    await this.redis.sadd('active_drafts', contestId);
    
    return draftState;
  }
  
  createSnakeDraftOrder(numPlayers) {
    const rounds = 5; // 5 picks per player
    const order = [];
    
    for (let round = 0; round < rounds; round++) {
      if (round % 2 === 0) {
        // Regular order
        for (let i = 0; i < numPlayers; i++) {
          order.push(i);
        }
      } else {
        // Reverse order (snake)
        for (let i = numPlayers - 1; i >= 0; i--) {
          order.push(i);
        }
      }
    }
    
    return order;
  }
  
  getTeamColor(index) {
    const colors = ['Green', 'Red', 'Blue', 'Yellow', 'Purple'];
    return colors[index % colors.length];
  }
  
  async getDraft(contestId) {
    try {
      const key = `state:${contestId}`;
      const draftData = await this.redis.get(key);
      
      if (!draftData) {
        return null;
      }
      
      return JSON.parse(draftData);
    } catch (error) {
      console.error('Error getting draft:', error);
      return null;
    }
  }
  
  async makePick(contestId, userId, pick) {
    // Use Redis transaction for atomic updates
    const multi = this.redis.multi();
    
    try {
      // Get current draft state
      const draft = await this.getDraft(contestId);
      if (!draft) {
        throw new Error('Draft not found');
      }
      
      const currentTeamIndex = draft.draftOrder[draft.currentTurn];
      const currentTeam = draft.teams[currentTeamIndex];
      
      // Validate it's the user's turn
      if (currentTeam.userId !== userId) {
        throw new Error('Not your turn');
      }
      
      // Update draft state
      draft.picks.push({
        ...pick,
        teamIndex: currentTeamIndex,
        pickNumber: draft.currentTurn,
        timestamp: new Date().toISOString()
      });
      
      // Update player board if position info provided
      if (pick.row !== undefined && pick.col !== undefined) {
        if (draft.playerBoard[pick.row] && draft.playerBoard[pick.row][pick.col]) {
          draft.playerBoard[pick.row][pick.col].drafted = true;
          draft.playerBoard[pick.row][pick.col].draftedBy = currentTeamIndex;
        }
      }
      
      // Update team roster
      currentTeam.roster[pick.rosterSlot] = pick.player;
      currentTeam.budget -= pick.player.price;
      
      // Calculate bonuses for kingpin/firesale if applicable
      if (pick.contestType === 'kingpin' || pick.contestType === 'firesale') {
        const bonus = this.calculateKingpinBonus(currentTeam, pick.player);
        currentTeam.bonus += bonus;
      }
      
      // Move to next turn
      draft.currentTurn++;
      
      // Check if draft is complete
      if (draft.currentTurn >= draft.draftOrder.length) {
        draft.status = 'completed';
        draft.completedAt = new Date().toISOString();
      }
      
      // Save updated state
      const key = `state:${contestId}`;
      await this.redis.set(key, JSON.stringify(draft), 'EX', 86400);
      
      // If completed, remove from active drafts
      if (draft.status === 'completed') {
        await this.redis.srem('active_drafts', contestId);
        
        // Schedule cleanup after 1 hour
        setTimeout(async () => {
          await this.cleanupDraft(contestId);
        }, 3600000);
      }
      
      return draft;
      
    } catch (error) {
      // Discard transaction on error
      multi.discard();
      throw error;
    }
  }
  
  calculateKingpinBonus(team, newPlayer) {
    let bonusAdded = 0;
    const roster = team.roster || {};
    const players = Object.values(roster).filter(p => p);
    
    // Check for duplicate player bonus
    const duplicates = players.filter(p => 
      p.name === newPlayer.name && p.team === newPlayer.team
    );
    if (duplicates.length === 1) { // Exactly one duplicate means this is the second
      bonusAdded++;
    }
    
    // Check for QB + pass catcher stack
    const teamQB = players.find(p => 
      (p.position === 'QB' || p.originalPosition === 'QB') && 
      p.team === newPlayer.team
    );
    const isPassCatcher = ['WR', 'TE'].includes(newPlayer.position) || 
      ['WR', 'TE'].includes(newPlayer.originalPosition);
    
    if (teamQB && isPassCatcher) {
      bonusAdded++;
    }
    
    // Or if new player is QB, check for existing pass catchers
    const isQB = newPlayer.position === 'QB' || newPlayer.originalPosition === 'QB';
    if (isQB) {
      const hasPassCatcher = players.some(p => 
        p.team === newPlayer.team &&
        (['WR', 'TE'].includes(p.position) || 
         ['WR', 'TE'].includes(p.originalPosition))
      );
      if (hasPassCatcher) {
        bonusAdded++;
      }
    }
    
    return bonusAdded;
  }
  
  async completeDraft(contestId) {
    try {
      const draft = await this.getDraft(contestId);
      if (!draft) return;
      
      // Update status
      draft.status = 'completed';
      draft.completedAt = new Date().toISOString();
      
      // Save final state
      const key = `state:${contestId}`;
      await this.redis.set(key, JSON.stringify(draft), 'EX', 86400);
      
      // Remove from active drafts
      await this.redis.srem('active_drafts', contestId);
      
      console.log(`Draft completed for contest ${contestId}`);
      
      // Emit completion event if socket.io is available
      if (this.io) {
        this.io.to(`draft_${contestId}`).emit('draft-completed', {
          contestId,
          teams: draft.teams,
          picks: draft.picks
        });
      }
      
      // Schedule cleanup after 1 hour
      setTimeout(async () => {
        await this.cleanupDraft(contestId);
      }, 3600000);
      
    } catch (error) {
      console.error('Error completing draft:', error);
    }
  }
  
  async cleanupDraft(contestId) {
    try {
      const key = `state:${contestId}`;
      await this.redis.del(key);
      console.log(`Cleaned up draft state for contest ${contestId}`);
    } catch (error) {
      console.error('Error cleaning up draft:', error);
    }
  }
  
  async getActiveDrafts() {
    try {
      // Get all active draft IDs
      const activeIds = await this.redis.smembers('active_drafts');
      
      // Get all draft states
      const drafts = [];
      for (const contestId of activeIds) {
        const draft = await this.getDraft(contestId);
        if (draft) {
          drafts.push(draft);
        }
      }
      
      return drafts;
    } catch (error) {
      console.error('Error getting active drafts:', error);
      return [];
    }
  }
  
  // Additional utility methods
  
  async getCurrentTurn(contestId) {
    try {
      const draft = await this.getDraft(contestId);
      if (!draft) return null;
      
      const currentTeamIndex = draft.draftOrder[draft.currentTurn];
      const currentTeam = draft.teams[currentTeamIndex];
      
      return {
        currentTurn: draft.currentTurn,
        totalTurns: draft.draftOrder.length,
        currentTeam: currentTeam,
        timeRemaining: 30 // Default 30 seconds per pick
      };
    } catch (error) {
      console.error('Error getting current turn:', error);
      return null;
    }
  }
  
  async skipTurn(contestId, userId, reason = 'timeout') {
    try {
      const draft = await this.getDraft(contestId);
      if (!draft) {
        throw new Error('Draft not found');
      }
      
      const currentTeamIndex = draft.draftOrder[draft.currentTurn];
      const currentTeam = draft.teams[currentTeamIndex];
      
      // Record skipped pick
      draft.picks.push({
        teamIndex: currentTeamIndex,
        pickNumber: draft.currentTurn,
        skipped: true,
        reason: reason,
        timestamp: new Date().toISOString()
      });
      
      // Move to next turn
      draft.currentTurn++;
      
      // Check if draft is complete
      if (draft.currentTurn >= draft.draftOrder.length) {
        draft.status = 'completed';
        draft.completedAt = new Date().toISOString();
      }
      
      // Save updated state
      const key = `state:${contestId}`;
      await this.redis.set(key, JSON.stringify(draft), 'EX', 86400);
      
      // Emit skip event
      if (this.io) {
        this.io.to(`draft_${contestId}`).emit('turn-skipped', {
          userId: currentTeam.userId,
          reason: reason,
          currentTurn: draft.currentTurn
        });
      }
      
      return draft;
    } catch (error) {
      console.error('Error skipping turn:', error);
      throw error;
    }
  }
  
  async updateTimer(contestId, timeRemaining) {
    try {
      const timerKey = `timer:${contestId}`;
      await this.redis.set(timerKey, timeRemaining, 'EX', 35);
      
      // Emit timer update
      if (this.io) {
        this.io.to(`draft_${contestId}`).emit('timer-update', timeRemaining);
      }
    } catch (error) {
      console.error('Error updating timer:', error);
    }
  }
  
  async getTimer(contestId) {
    try {
      const timerKey = `timer:${contestId}`;
      const time = await this.redis.get(timerKey);
      return time ? parseInt(time) : 0;
    } catch (error) {
      console.error('Error getting timer:', error);
      return 0;
    }
  }
  
  // Health check
  async healthCheck() {
    try {
      await this.redis.ping();
      return { redis: true, status: 'healthy' };
    } catch (error) {
      console.error('DraftService health check failed:', error);
      return { redis: false, status: 'unhealthy', error: error.message };
    }
  }
  
  // Cleanup on shutdown
  async cleanup() {
    try {
      await this.redis.quit();
      console.log('DraftService cleanup completed');
    } catch (error) {
      console.error('Error during DraftService cleanup:', error);
    }
  }
}

// Create and export singleton instance
module.exports = new DraftService();