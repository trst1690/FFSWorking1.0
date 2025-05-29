// backend/src/services/contestService.js
const { Op } = require('sequelize');
const db = require('../models');
const { generatePlayerBoard } = require('../utils/gameLogic');
const draftService = require('./draftService');
const Redis = require('ioredis');

// Constants
const ROOM_SIZES = {
  cash: 5,
  market: 5,
  bash: 5,
  firesale: 5
};

const CONTEST_LIMITS = {
  cash: 1,
  market: 150,
  bash: 150,
  firesale: 150
};

const UNFILLED_ROOM_LIMIT = 20;

class ContestService {
  constructor() {
    this.io = null;
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      keyPrefix: 'ffsale:'
    });
    this.activeDrafts = new Map();
    this.draftTimers = new Map();
  }

  setSocketIO(io) {
    this.io = io;
    draftService.setSocketIO(io);
    console.log('Socket.IO instance set in ContestService');
  }

  setIo(io) {
    this.setSocketIO(io);
  }

  // Distributed lock using Redis
  async acquireLock(key, timeout = 5000) {
    const lockKey = `lock:${key}`;
    const lockValue = Date.now() + timeout;
    
    // Try to set lock with NX (only if not exists)
    const acquired = await this.redis.set(
      lockKey, 
      lockValue, 
      'PX', 
      timeout, 
      'NX'
    );
    
    return acquired === 'OK';
  }

  async releaseLock(key) {
    const lockKey = `lock:${key}`;
    await this.redis.del(lockKey);
  }

  // Get all open contests
  async getContests() {
    try {
      const contests = await db.Contest.findAll({
        where: { 
          status: 'open'
        },
        order: [
          ['type', 'ASC'],
          ['created_at', 'DESC']
        ]
      });

      // For cash games, only show the latest open one
      const cashGames = contests.filter(c => c.type === 'cash');
      const latestOpenCashGame = cashGames.length > 0 ? cashGames[0] : null;
      const otherContests = contests.filter(c => c.type !== 'cash');
      
      const finalContests = [];
      if (latestOpenCashGame) {
        finalContests.push(latestOpenCashGame);
      }
      finalContests.push(...otherContests);

      return finalContests.map(contest => ({
        id: contest.id,
        type: contest.type,
        name: contest.name,
        status: contest.status,
        entryFee: parseFloat(contest.entry_fee),
        prizePool: parseFloat(contest.prize_pool),
        maxEntries: contest.max_entries,
        currentEntries: contest.current_entries || 0,
        maxEntriesPerUser: contest.max_entries_per_user || (contest.type === 'cash' ? 1 : 150),
        playerBoard: contest.player_board,
        startTime: contest.start_time,
        endTime: contest.end_time,
        scoringType: contest.scoring_type,
        maxSalary: contest.max_salary
      }));
    } catch (error) {
      console.error('Error getting contests:', error);
      return [];
    }
  }

  async getContest(contestId) {
    try {
      const contest = await db.Contest.findByPk(contestId);
      if (!contest) return null;
      
      return {
        id: contest.id,
        type: contest.type,
        name: contest.name,
        status: contest.status,
        entryFee: parseFloat(contest.entry_fee),
        prizePool: parseFloat(contest.prize_pool),
        maxEntries: contest.max_entries,
        currentEntries: contest.current_entries || 0,
        maxEntriesPerUser: contest.max_entries_per_user || (contest.type === 'cash' ? 1 : 150),
        playerBoard: contest.player_board,
        startTime: contest.start_time,
        endTime: contest.end_time
      };
    } catch (error) {
      console.error('Error getting contest:', error);
      return null;
    }
  }

  async getUserEntries(userId) {
    try {
      const entries = await db.ContestEntry.findAll({
        where: { 
          user_id: userId,
          status: { [Op.ne]: 'cancelled' }
        },
        include: [{
          model: db.Contest,
          attributes: ['name', 'type', 'entry_fee', 'prize_pool', 'player_board', 'status', 'current_entries', 'max_entries']
        }],
        order: [['created_at', 'DESC']]
      });

      return entries.map(entry => ({
        id: entry.id,
        userId: entry.user_id,
        contestId: entry.contest_id,
        contestName: entry.Contest?.name,
        contestType: entry.Contest?.type,
        contestStatus: entry.Contest?.status,
        entryFee: entry.Contest ? parseFloat(entry.Contest.entry_fee) : 0,
        prizePool: entry.Contest ? parseFloat(entry.Contest.prize_pool) : 0,
        draftRoomId: entry.draft_room_id,
        status: entry.status,
        roster: entry.roster,
        lineup: entry.lineup,
        totalSpent: entry.total_spent,
        totalPoints: parseFloat(entry.total_points || 0),
        finalRank: entry.final_rank,
        prizeWon: parseFloat(entry.prize_won || 0),
        enteredAt: entry.entered_at,
        completedAt: entry.completed_at,
        Contest: entry.Contest
      }));
    } catch (error) {
      console.error('Error getting user entries:', error);
      return [];
    }
  }

  async getUserUnfilledRoomsCount(userId) {
    try {
      const pendingEntries = await db.ContestEntry.findAll({
        where: {
          user_id: userId,
          status: 'pending'
        },
        include: [{
          model: db.Contest,
          attributes: ['type']
        }]
      });

      const unfilledRooms = new Set();

      for (const entry of pendingEntries) {
        const roomEntryCount = await db.ContestEntry.count({
          where: {
            draft_room_id: entry.draft_room_id,
            status: { [Op.in]: ['pending', 'drafting'] }
          }
        });

        const maxPlayers = 5;
        if (roomEntryCount < maxPlayers) {
          unfilledRooms.add(entry.draft_room_id);
        }
      }

      return unfilledRooms.size;
    } catch (error) {
      console.error('Error checking unfilled rooms:', error);
      return 0;
    }
  }

  // Main enter contest method with improved error handling
  async enterContest(contestId, userId, username) {
    const lockKey = `contest:${contestId}:user:${userId}`;
    const lockAcquired = await this.acquireLock(lockKey);
    
    if (!lockAcquired) {
      throw new Error('Another request is being processed. Please try again.');
    }

    const transaction = await db.sequelize.transaction({
      isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
    });

    try {
      // 1. Get and validate contest with row lock
      const contest = await db.Contest.findByPk(contestId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!contest) {
        throw new Error('Contest not found');
      }

      console.log(`Entering contest: ${contest.name} (${contest.type}), Status: ${contest.status}, Entries: ${contest.current_entries}/${contest.max_entries}`);

      if (contest.status !== 'open') {
        throw new Error('Contest is not accepting entries');
      }

      if (contest.current_entries >= contest.max_entries) {
        throw new Error('Contest is full');
      }

      // 2. Get and validate user with row lock
      const user = await db.User.findByPk(userId, { 
        lock: transaction.LOCK.UPDATE,
        transaction 
      });
      
      if (!user) {
        throw new Error('User not found');
      }

      const userBalance = parseFloat(user.balance);
      const entryFee = parseFloat(contest.entry_fee);
      
      if (userBalance < entryFee) {
        throw new Error(`Insufficient balance. You need $${entryFee.toFixed(2)} but only have $${userBalance.toFixed(2)}`);
      }

      // 3. Check user entry limits
      const totalUserEntries = await db.ContestEntry.count({
        where: {
          contest_id: contestId,
          user_id: userId,
          status: { [Op.ne]: 'cancelled' }
        },
        transaction
      });

      const effectiveLimit = contest.type === 'cash' ? 1 : (contest.max_entries_per_user || 150);

      if (totalUserEntries >= effectiveLimit) {
        throw new Error(`Maximum entries (${effectiveLimit}) reached for this contest`);
      }

      // 4. Check unfilled rooms for non-cash contests
      if (contest.type !== 'cash') {
        const unfilledCount = await this.getUserUnfilledRoomsCount(userId);
        if (unfilledCount >= UNFILLED_ROOM_LIMIT) {
          throw new Error(`Maximum ${UNFILLED_ROOM_LIMIT} unfilled draft rooms allowed. Please wait for your drafts to start.`);
        }
      }

      // 5. Find or create room
      let roomId = contestId; // Cash games use contest ID as room
      if (['market', 'bash', 'firesale'].includes(contest.type)) {
        roomId = await this.findOrCreateRoom(contestId, userId, transaction);
        
        // Store room board in Redis for Market Mover
        if (contest.type === 'market') {
          const boardKey = `board:${roomId}`;
          const existingBoard = await this.redis.get(boardKey);
          
          if (!existingBoard) {
            const newBoard = generatePlayerBoard();
            await this.redis.set(boardKey, JSON.stringify(newBoard), 'EX', 86400); // 24 hour expiry
            console.log(`Generated new unique player board for Market Mover room ${roomId}`);
          }
        }
      }

      // 6. Create entry
      const entry = await db.ContestEntry.create({
        user_id: userId,
        contest_id: contestId,
        draft_room_id: roomId,
        status: 'pending',
        entered_at: new Date()
      }, { transaction });

      // 7. Update user balance
      const newBalance = userBalance - entryFee;
      await user.update({ balance: newBalance }, { transaction });

      // 8. Create transaction record
      await db.Transaction.create({
        user_id: userId,
        type: 'contest_entry',
        amount: -entryFee,
        balance_after: newBalance,
        contest_id: contestId,
        description: `Entry fee for ${contest.name}`
      }, { transaction });

      // 9. Update contest entries using atomic increment
      await contest.increment('current_entries', { transaction });
      
      let newCashGameCreated = false;
      let newCashGameData = null;
      
      // 10. Handle full contest
      if (contest.current_entries + 1 >= contest.max_entries) {
        console.log(`Contest ${contestId} (${contest.name}) is now full`);
        
        if (contest.type === 'cash') {
          console.log(`Cash game ${contestId} is full, creating replacement...`);
          
          try {
            // Find next game number
            const cashGames = await db.Contest.findAll({
              where: {
                type: 'cash',
                name: { [Op.like]: 'Cash Game #%' }
              },
              attributes: ['name'],
              transaction
            });

            let maxNumber = 0;
            cashGames.forEach(game => {
              const match = game.name.match(/Cash Game #(\d+)/);
              if (match) {
                maxNumber = Math.max(maxNumber, parseInt(match[1]));
              }
            });

            const nextNumber = maxNumber + 1;
            
            // Create new cash game
            const newCashGame = await db.Contest.create({
              type: 'cash',
              name: `Cash Game #${nextNumber}`,
              status: 'open',
              entry_fee: contest.entry_fee,
              prize_pool: contest.prize_pool,
              max_entries: contest.max_entries,
              current_entries: 0,
              max_entries_per_user: 1,
              player_board: generatePlayerBoard(),
              start_time: new Date(),
              end_time: new Date(Date.now() + 7200000),
              scoring_type: contest.scoring_type,
              max_salary: 15
            }, { transaction });
            
            console.log(`Successfully created new cash game: ${newCashGame.id} (${newCashGame.name})`);
            
            newCashGameCreated = true;
            newCashGameData = {
              id: newCashGame.id,
              type: newCashGame.type,
              name: newCashGame.name,
              status: newCashGame.status,
              entryFee: parseFloat(newCashGame.entry_fee),
              prizePool: parseFloat(newCashGame.prize_pool),
              maxEntries: newCashGame.max_entries,
              currentEntries: 0,
              maxEntriesPerUser: 1,
              playerBoard: newCashGame.player_board,
              startTime: newCashGame.start_time,
              endTime: newCashGame.end_time,
              scoringType: newCashGame.scoring_type,
              maxSalary: newCashGame.max_salary
            };
          } catch (error) {
            console.error('Error creating new cash game:', error);
          }
        }
        
        await contest.update({ status: 'closed' }, { transaction });
      }
      
      await transaction.commit();

      // 11. Post-commit actions
      if (this.io) {
        // Emit contest update
        this.io.emit('contest-updated', {
          contest: {
            id: contest.id,
            type: contest.type,
            name: contest.name,
            status: contest.status === 'open' && contest.current_entries + 1 >= contest.max_entries ? 'closed' : contest.status,
            currentEntries: contest.current_entries + 1,
            maxEntries: contest.max_entries
          }
        });

        // Emit new cash game if created
        if (newCashGameCreated && newCashGameData) {
          setTimeout(() => {
            this.io.emit('contest-created', {
              contest: newCashGameData,
              replacedContestId: contestId,
              message: `${contest.name} is full. ${newCashGameData.name} is now available!`
            });
          }, 100);
        }
      }

      // Check if draft should start
      setImmediate(async () => {
        await this.checkAndLaunchDraft(roomId, contest);
      });

      console.log(`User ${username} entered ${contest.name}. Entries: ${contest.current_entries + 1}/${contest.max_entries}`);

      return {
        success: true,
        id: entry.id,
        entry: {
          id: entry.id,
          userId: entry.user_id,
          contestId: contestId,
          draftRoomId: roomId,
          status: entry.status,
          enteredAt: entry.entered_at
        },
        entryId: entry.id,
        draftRoomId: roomId,
        contestId: contestId,
        newBalance: newBalance,
        contestFull: contest.current_entries + 1 >= contest.max_entries,
        newCashGameId: newCashGameData?.id
      };

    } catch (error) {
      await transaction.rollback();
      console.error('Error entering contest:', error);
      throw error;
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  // Check and launch draft when room is full
  async checkAndLaunchDraft(roomId, contest) {
    try {
      console.log(`Checking if draft should launch for room ${roomId}`);
      
      // Get room status
      const roomStatus = await this.getRoomStatus(roomId);
      if (!roomStatus) {
        console.log('Room status not found');
        return;
      }

      console.log(`Room ${roomId}: ${roomStatus.currentPlayers}/${roomStatus.maxPlayers} players`);

      // Check if room is full
      if (roomStatus.currentPlayers >= roomStatus.maxPlayers && roomStatus.status === 'ready') {
        console.log(`Room ${roomId} is full! Launching draft...`);
        await this.launchDraft(roomId, roomStatus, contest);
      }
    } catch (error) {
      console.error('Error checking draft launch:', error);
    }
  }

  // Launch a draft
  async launchDraft(roomId, roomStatus, contest) {
    try {
      console.log(`🚀 LAUNCHING DRAFT for room ${roomId}`);
      
      // Prevent duplicate launches
      if (this.activeDrafts.has(roomId)) {
        console.log(`Draft already active for room ${roomId}`);
        return;
      }

      // Use draftService to start the draft
      const draftState = await draftService.startDraft(
        roomId,
        roomStatus.entries,
        roomStatus.playerBoard
      );

      // Mark draft as active
      this.activeDrafts.set(roomId, {
        roomId,
        contestId: roomStatus.contestId,
        contestType: roomStatus.contestType,
        startTime: new Date(),
        participants: roomStatus.entries,
        currentTurn: 0,
        picks: []
      });

      // Update all entries to 'drafting' status
      await db.ContestEntry.update(
        { status: 'drafting' },
        {
          where: {
            draft_room_id: roomId,
            status: 'pending'
          }
        }
      );

      // Emit draft starting event
      if (this.io) {
        // 5 second countdown
        this.io.to(`room_${roomId}`).emit('draft-countdown', {
          roomId,
          contestId: roomStatus.contestId,
          seconds: 5
        });

        // Start draft after countdown
        setTimeout(() => {
          this.io.to(`room_${roomId}`).emit('draft-starting', {
            roomId: roomId,
            contestId: roomStatus.contestId,
            playerBoard: roomStatus.playerBoard,
            participants: roomStatus.entries.map((e, index) => ({
              entryId: e.id,
              userId: e.userId,
              username: e.username,
              draftPosition: index
            }))
          });

          // Start the first pick after a brief delay
          setTimeout(() => {
            this.startNextPick(roomId);
          }, 2000);
        }, 5000);
      }

      console.log(`✅ Draft launched successfully for room ${roomId}`);
    } catch (error) {
      console.error('Error launching draft:', error);
      this.activeDrafts.delete(roomId);
    }
  }

  // Start next pick in draft
  async startNextPick(roomId) {
    const draft = this.activeDrafts.get(roomId);
    if (!draft) return;

    const draftState = await draftService.getDraft(roomId);
    if (!draftState) return;

    const totalPicks = draftState.teams.length * 5; // 5 picks per player
    
    if (draftState.currentTurn >= totalPicks) {
      // Draft complete
      await this.completeDraftForRoom(roomId);
      return;
    }

    const currentPlayerIndex = draftState.draftOrder[draftState.currentTurn];
    const currentPlayer = draftState.teams[currentPlayerIndex];

    // Emit turn event
    if (this.io) {
      this.io.to(`room_${roomId}`).emit('draft-turn', {
        roomId,
        currentPick: draftState.currentTurn + 1,
        totalPicks,
        currentPlayer: {
          userId: currentPlayer.userId,
          username: currentPlayer.username,
          position: currentPlayerIndex
        },
        timeLimit: 30 // 30 seconds per pick
      });
    }

    // Set timer for auto-pick
    const timerId = setTimeout(() => {
      this.handleAutoPick(roomId, currentPlayer.userId);
    }, 30000);

    this.draftTimers.set(`${roomId}_${currentPlayer.userId}`, timerId);
  }

  // Handle player pick
  async handlePlayerPick(roomId, userId, playerData, position) {
    const draft = this.activeDrafts.get(roomId);
    if (!draft) {
      throw new Error('Draft not found');
    }

    // Clear timer
    const timerId = this.draftTimers.get(`${roomId}_${userId}`);
    if (timerId) {
      clearTimeout(timerId);
      this.draftTimers.delete(`${roomId}_${userId}`);
    }

    // Use draftService to make the pick
    const updatedDraft = await draftService.makePick(roomId, userId, {
      player: playerData,
      rosterSlot: position,
      row: playerData.row,
      col: playerData.col,
      contestType: draft.contestType
    });

    // Save pick to database
    const entry = await db.ContestEntry.findOne({
      where: {
        draft_room_id: roomId,
        user_id: userId,
        status: 'drafting'
      }
    });

    if (entry) {
      await this.saveDraftPick(entry.id, {
        player: playerData,
        rosterSlot: position,
        pickNumber: updatedDraft.picks.length,
        isAutoPick: false
      });
    }

    // Emit pick made event
    if (this.io) {
      this.io.to(`room_${roomId}`).emit('pick-made', {
        roomId,
        userId,
        player: playerData,
        position,
        pickNumber: updatedDraft.picks.length
      });
    }

    // Start next pick
    await this.startNextPick(roomId);
  }

  // Handle auto pick
  async handleAutoPick(roomId, userId) {
    console.log(`Auto-picking for user ${userId} in room ${roomId}`);
    
    // Implementation would select best available player
    // For now, just skip the turn
    await draftService.skipTurn(roomId, userId, 'timeout');
    
    await this.startNextPick(roomId);
  }

  // Complete draft for room
  async completeDraftForRoom(roomId) {
    const draft = this.activeDrafts.get(roomId);
    if (!draft) return;

    console.log(`Completing draft for room ${roomId}`);

    // Update all entries to completed
    await db.ContestEntry.update(
      { 
        status: 'completed',
        completed_at: new Date()
      },
      {
        where: {
          draft_room_id: roomId,
          status: 'drafting'
        }
      }
    );

    // Complete the draft in draftService
    await draftService.completeDraft(roomId);

    // Emit draft complete event
    if (this.io) {
      this.io.to(`room_${roomId}`).emit('draft-complete', {
        roomId,
        contestId: draft.contestId,
        message: 'Draft completed! Good luck!'
      });
    }

    // Clean up
    this.activeDrafts.delete(roomId);
    
    // Clear any remaining timers
    for (const [key, timerId] of this.draftTimers) {
      if (key.startsWith(`${roomId}_`)) {
        clearTimeout(timerId);
        this.draftTimers.delete(key);
      }
    }

    console.log(`✅ Draft completed for room ${roomId}`);
  }

  async findOrCreateRoom(contestId, userId, transaction) {
    console.log(`\n=== FINDING ROOM FOR USER ${userId} IN CONTEST ${contestId} ===`);
    
    // Get all rooms with their active entry counts
    const allRooms = await db.ContestEntry.findAll({
      attributes: [
        'draft_room_id',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'entry_count']
      ],
      where: {
        contest_id: contestId,
        status: { [Op.notIn]: ['cancelled', 'completed'] }
      },
      group: ['draft_room_id'],
      raw: true,
      transaction
    });

    console.log('All rooms for contest:', allRooms);

    // Find rooms with less than 5 active players
    const availableRooms = allRooms.filter(room => parseInt(room.entry_count) < 5);
    console.log('Available rooms (less than 5 players):', availableRooms);

    for (const room of availableRooms) {
      const roomId = room.draft_room_id;
      
      // Check if user already has an active entry in this room
      const userInRoom = await db.ContestEntry.findOne({
        where: {
          draft_room_id: roomId,
          user_id: userId,
          status: { [Op.notIn]: ['cancelled', 'completed'] }
        },
        transaction
      });

      if (!userInRoom) {
        console.log(`User not in room ${roomId}, checking current count...`);
        
        // Double-check current active count WITHOUT LOCK - THIS IS THE FIX
        const currentCount = await db.ContestEntry.count({
          where: {
            draft_room_id: roomId,
            status: { [Op.notIn]: ['cancelled', 'completed'] }
          },
          transaction
          // REMOVED: lock: transaction.LOCK.SHARE - This was causing the SQL error!
        });
        
        console.log(`Room ${roomId} has ${currentCount}/5 active players`);
        
        if (currentCount < 5) {
          console.log(`Assigning user to existing room: ${roomId}`);
          return roomId;
        }
      } else {
        console.log(`User already has active entry in room ${roomId}, skipping...`);
      }
    }

    // Create a new room with proper numbering
    const maxRoomNumber = await this.redis.incr(`room_counter:${contestId}`);
    const newRoomId = `${contestId}_room_${maxRoomNumber}`;
    console.log(`Creating new room: ${newRoomId} (room #${maxRoomNumber})`);
    
    return newRoomId;
  }

  async withdrawEntry(entryId, userId) {
    const lockKey = `withdraw:${entryId}:${userId}`;
    const lockAcquired = await this.acquireLock(lockKey);
    
    if (!lockAcquired) {
      throw new Error('Another request is being processed. Please try again.');
    }

    const transaction = await db.sequelize.transaction({
      isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
    });

    try {
      const entry = await db.ContestEntry.findOne({
        where: {
          id: entryId,
          user_id: userId
        },
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!entry) {
        throw new Error('Entry not found');
      }

      if (entry.status !== 'pending') {
        throw new Error('Cannot withdraw after draft has started');
      }

      const contest = await db.Contest.findByPk(entry.contest_id, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!contest) {
        throw new Error('Contest not found');
      }

      // Update entry status
      await entry.update({ status: 'cancelled' }, { transaction });

      // Refund user
      const user = await db.User.findByPk(userId, { 
        lock: transaction.LOCK.UPDATE,
        transaction 
      });
      
      const refundAmount = parseFloat(contest.entry_fee);
      const newBalance = parseFloat(user.balance) + refundAmount;
      
      await user.update({ balance: newBalance }, { transaction });

      // Create transaction record for refund
      await db.Transaction.create({
        user_id: userId,
        type: 'contest_refund',
        amount: refundAmount,
        balance_after: newBalance,
        contest_id: entry.contest_id,
        description: `Refund for ${contest.name} withdrawal`
      }, { transaction });

      // Update contest entry count atomically
      if (contest.current_entries > 0) {
        await contest.decrement('current_entries', { transaction });
        
        // If contest was closed/full and now has space, reopen it
        if (contest.status === 'closed' && contest.current_entries - 1 < contest.max_entries) {
          await contest.update({ status: 'open' }, { transaction });
          console.log(`Reopened contest ${contest.id} after withdrawal`);
        }
      }

      await transaction.commit();

      console.log(`User ${userId} withdrew from ${contest.name}. Entries: ${contest.current_entries - 1}/${contest.max_entries}`);

      // Emit socket event for contest update
      if (this.io) {
        this.io.emit('contest-updated', {
          contest: {
            id: contest.id,
            type: contest.type,
            name: contest.name,
            status: contest.status,
            currentEntries: Math.max(0, contest.current_entries - 1),
            maxEntries: contest.max_entries
          }
        });
      }

      return { 
        success: true, 
        refund: refundAmount,
        newBalance: newBalance
      };

    } catch (error) {
      await transaction.rollback();
      console.error('Error withdrawing entry:', error);
      throw error;
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async saveDraftPick(entryId, pickData) {
    const transaction = await db.sequelize.transaction();

    try {
      const entry = await db.ContestEntry.findByPk(entryId, { 
        lock: transaction.LOCK.UPDATE,
        transaction 
      });
      
      if (!entry) {
        throw new Error('Entry not found');
      }

      if (entry.status === 'pending') {
        await entry.update({ status: 'drafting' }, { transaction });
      }

      // Save individual draft pick for analytics
      await db.DraftPick.create({
        entry_id: entryId,
        pick_number: pickData.pickNumber || 0,
        player_data: pickData.player,
        roster_slot: pickData.rosterSlot,
        is_auto_pick: pickData.isAutoPick || false
      }, { transaction });

      const lineup = entry.lineup || [];
      lineup.push({
        player: pickData.player,
        rosterSlot: pickData.rosterSlot
      });

      await entry.update({ lineup }, { transaction });
      await transaction.commit();

      console.log(`Saved pick for entry ${entryId}: ${pickData.player.name} to ${pickData.rosterSlot}`);
      return true;

    } catch (error) {
      await transaction.rollback();
      console.error('Error saving draft pick:', error);
      return false;
    }
  }

  async completeDraft(entryId, roster, totalSpent) {
    const transaction = await db.sequelize.transaction();

    try {
      const entry = await db.ContestEntry.findByPk(entryId, {
        include: [db.Contest],
        lock: transaction.LOCK.UPDATE,
        transaction
      });

      if (!entry) {
        throw new Error('Entry not found');
      }

      const lineup = [];
      Object.entries(roster).forEach(([slot, player]) => {
        if (player) {
          lineup.push({
            player,
            rosterSlot: slot
          });
        }
      });

      await entry.update({
        status: 'completed',
        roster,
        lineup,
        total_spent: totalSpent,
        completed_at: new Date()
      }, { transaction });

      // Award ticket for completing draft
      const user = await db.User.findByPk(entry.user_id, { 
        lock: transaction.LOCK.UPDATE,
        transaction 
      });
      
      if (user) {
        await user.increment('tickets', { by: 1, transaction });
        
        // Create ticket transaction record
        await db.TicketTransaction.create({
          user_id: entry.user_id,
          type: 'draft_completion',
          amount: 1,
          balance_after: user.tickets + 1,
          reason: `Completed draft for ${entry.Contest.name}`
        }, { transaction });
      }

      await transaction.commit();

      console.log(`Entry ${entryId} marked as completed with ${lineup.length} players`);
      return entry;

    } catch (error) {
      await transaction.rollback();
      console.error('Error completing draft:', error);
      throw error;
    }
  }

  async getContestEntry(entryId) {
    try {
      const entry = await db.ContestEntry.findByPk(entryId, {
        include: [{
          model: db.Contest,
          attributes: ['name', 'type', 'entry_fee', 'prize_pool', 'player_board']
        }]
      });

      if (!entry) return null;

      return {
        id: entry.id,
        userId: entry.user_id,
        contestId: entry.contest_id,
        contest: entry.Contest,
        draftRoomId: entry.draft_room_id,
        status: entry.status,
        roster: entry.roster,
        lineup: entry.lineup,
        totalSpent: entry.total_spent
      };
    } catch (error) {
      console.error('Error getting contest entry:', error);
      return null;
    }
  }

  async getRoomStatus(roomId) {
    try {
      console.log(`Getting room status for: ${roomId}`);
      
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
      
      // For cash games, use the contest directly
      if (isUUID) {
        const contest = await db.Contest.findByPk(roomId);
        if (contest && contest.type === 'cash') {
          // Get only active entries
          const entries = await db.ContestEntry.findAll({
            where: {
              contest_id: roomId,
              status: { [Op.notIn]: ['cancelled', 'completed'] }
            },
            include: [{
              model: db.User,
              attributes: ['username']
            }],
            order: [['entered_at', 'ASC']],
            limit: 5
          });

          return {
            id: roomId,
            contestId: roomId,
            contestType: 'cash',
            entries: entries.map((e, index) => ({
              id: e.id,
              userId: e.user_id,
              username: e.User?.username || 'Unknown',
              contestId: e.contest_id,
              draftRoomId: e.draft_room_id,
              draftPosition: index,
              status: e.status,
              enteredAt: e.entered_at
            })),
            currentPlayers: entries.length,
            maxPlayers: 5,
            status: entries.length < 5 ? 'waiting' : 'ready',
            playerBoard: contest.player_board
          };
        }
      }

      // For tournament rooms
      const entries = await db.ContestEntry.findAll({
        where: {
          draft_room_id: roomId,
          status: { [Op.notIn]: ['cancelled', 'completed'] }
        },
        include: [{
          model: db.User,
          attributes: ['username']
        }, {
          model: db.Contest,
          attributes: ['type', 'player_board']
        }],
        order: [['entered_at', 'ASC']],
        limit: 5
      });

      if (entries.length > 0) {
        const contest = entries[0].Contest;
        let playerBoard;
        
        // Get board based on contest type
        if (contest.type === 'market') {
          // Market Mover: Get unique board from Redis
          const boardKey = `board:${roomId}`;
          const boardData = await this.redis.get(boardKey);
          
          if (boardData) {
            playerBoard = JSON.parse(boardData);
          } else {
            // Generate new board if not found
            playerBoard = generatePlayerBoard();
            await this.redis.set(boardKey, JSON.stringify(playerBoard), 'EX', 86400);
            console.log(`Generated new board for Market Mover room ${roomId}`);
          }
        } else {
          // Daily Bash & Firesale: Use the contest's preset board
          playerBoard = contest.player_board;
        }
        
        return {
          id: roomId,
          contestId: entries[0].contest_id,
          contestType: contest?.type,
          entries: entries.map((e, index) => ({
            id: e.id,
            userId: e.user_id,
            username: e.User?.username || 'Unknown',
            contestId: e.contest_id,
            draftRoomId: e.draft_room_id,
            draftPosition: index,
            status: e.status,
            enteredAt: e.entered_at
          })),
          currentPlayers: entries.length,
          maxPlayers: 5,
          status: entries.length < 5 ? 'waiting' : 'ready',
          playerBoard: playerBoard
        };
      }

      // Empty room - try to get contest info
      if (roomId.includes('_room_')) {
        const contestId = roomId.split('_room_')[0];
        const contest = await db.Contest.findByPk(contestId);
        if (contest) {
          let playerBoard;
          
          if (contest.type === 'market') {
            const boardKey = `board:${roomId}`;
            const boardData = await this.redis.get(boardKey);
            
            if (boardData) {
              playerBoard = JSON.parse(boardData);
            } else {
              playerBoard = generatePlayerBoard();
              await this.redis.set(boardKey, JSON.stringify(playerBoard), 'EX', 86400);
            }
          } else {
            playerBoard = contest.player_board;
          }
          
          return {
            id: roomId,
            contestId: contestId,
            contestType: contest.type,
            entries: [],
            currentPlayers: 0,
            maxPlayers: 5,
            status: 'waiting',
            playerBoard: playerBoard
          };
        }
      }

      console.log(`Room ${roomId} not found`);
      return null;
    } catch (error) {
      console.error('Error getting room status:', error);
      return null;
    }
  }

  async getUserContestHistory(userId, limit = 50) {
    try {
      const entries = await db.ContestEntry.findAll({
        where: {
          user_id: userId,
          status: 'completed'
        },
        include: [{
          model: db.Contest,
          attributes: ['name', 'type', 'entry_fee', 'prize_pool', 'status']
        }],
        order: [['completed_at', 'DESC']],
        limit
      });

      return entries.map(entry => ({
        id: entry.id,
        contestName: entry.Contest?.name,
        contestType: entry.Contest?.type,
        contestStatus: entry.Contest?.status,
        entryFee: entry.Contest ? parseFloat(entry.Contest.entry_fee) : 0,
        prizePool: entry.Contest ? parseFloat(entry.Contest.prize_pool) : 0,
        totalPoints: parseFloat(entry.total_points || 0),
        finalRank: entry.final_rank,
        prizeWon: parseFloat(entry.prize_won || 0),
        completedAt: entry.completed_at,
        roster: entry.roster
      }));
    } catch (error) {
      console.error('Error getting user contest history:', error);
      return [];
    }
  }

  async calculateOwnership(contestId, playerName) {
    try {
      const contest = await db.Contest.findByPk(contestId);
      if (!contest || contest.type !== 'market') {
        throw new Error('Ownership queries only available for Market Mover contests');
      }

      const completedEntries = await db.ContestEntry.findAll({
        where: {
          contest_id: contestId,
          status: 'completed'
        },
        attributes: ['lineup']
      });

      if (completedEntries.length === 0) {
        return 0;
      }

      const entriesWithPlayer = completedEntries.filter(entry => 
        entry.lineup && entry.lineup.some(pick => pick.player.name === playerName)
      );

      const ownership = (entriesWithPlayer.length / completedEntries.length) * 100;
      return Math.round(ownership * 10) / 10;
    } catch (error) {
      console.error('Error calculating ownership:', error);
      throw error;
    }
  }

  async getEntry(entryId) {
    try {
      const entry = await db.ContestEntry.findByPk(entryId, {
        include: [{
          model: db.Contest,
          attributes: ['name', 'type', 'entry_fee', 'prize_pool', 'player_board']
        }]
      });

      if (!entry) return null;

      return {
        id: entry.id,
        userId: entry.user_id,
        contestId: entry.contest_id,
        contest: entry.Contest,
        draftRoomId: entry.draft_room_id,
        status: entry.status,
        roster: entry.roster,
        lineup: entry.lineup,
        totalSpent: entry.total_spent,
        enteredAt: entry.entered_at,
        completedAt: entry.completed_at
      };
    } catch (error) {
      console.error('Error getting entry:', error);
      return null;
    }
  }

  async updateContestStatus(contestId, newStatus) {
    try {
      const contest = await db.Contest.findByPk(contestId);
      if (!contest) {
        throw new Error('Contest not found');
      }

      const validStatuses = ['open', 'closed', 'live', 'completed'];
      if (!validStatuses.includes(newStatus)) {
        throw new Error('Invalid status');
      }

      contest.status = newStatus;
      await contest.save();

      console.log(`Updated contest ${contestId} status to ${newStatus}`);
      return contest;
    } catch (error) {
      console.error('Error updating contest status:', error);
      throw error;
    }
  }

  async getAllContests(includeCompleted = false) {
    try {
      const where = includeCompleted ? {} : { status: { [Op.ne]: 'completed' } };
      
      const contests = await db.Contest.findAll({
        where,
        order: [['created_at', 'DESC']]
      });

      return contests.map(contest => ({
        id: contest.id,
        type: contest.type,
        name: contest.name,
        status: contest.status,
        entryFee: parseFloat(contest.entry_fee),
        prizePool: parseFloat(contest.prize_pool),
        maxEntries: contest.max_entries,
        currentEntries: contest.current_entries || 0,
        maxEntriesPerUser: contest.max_entries_per_user || (contest.type === 'cash' ? 1 : 150),
        startTime: contest.start_time,
        endTime: contest.end_time,
        createdAt: contest.created_at,
        updatedAt: contest.updated_at
      }));
    } catch (error) {
      console.error('Error getting all contests:', error);
      return [];
    }
  }

  async ensureCashGameAvailable() {
    try {
      const openCashGames = await db.Contest.findAll({
        where: {
          type: 'cash',
          status: 'open'
        }
      });

      if (openCashGames.length === 0) {
        console.log('No open cash games found, creating one...');
        
        const allCashGames = await db.Contest.findAll({
          where: {
            type: 'cash',
            name: { [Op.like]: 'Cash Game #%' }
          },
          attributes: ['name']
        });

        let maxNumber = 0;
        allCashGames.forEach(game => {
          const match = game.name.match(/Cash Game #(\d+)/);
          if (match) {
            maxNumber = Math.max(maxNumber, parseInt(match[1]));
          }
        });

        const nextNumber = maxNumber + 1;
        
        const newCashGame = await db.Contest.create({
          type: 'cash',
          name: `Cash Game #${nextNumber}`,
          status: 'open',
          entry_fee: 5,
          prize_pool: 25,
          max_entries: 5,
          current_entries: 0,
          max_entries_per_user: 1,
          player_board: generatePlayerBoard(),
          start_time: new Date(),
          end_time: new Date(Date.now() + 7200000),
          scoring_type: 'standard',
          max_salary: 15
        });

        console.log(`Created new cash game: ${newCashGame.name}`);
        
        if (this.io) {
          this.io.emit('contest-created', {
            contest: {
              id: newCashGame.id,
              type: newCashGame.type,
              name: newCashGame.name,
              status: newCashGame.status,
              entryFee: parseFloat(newCashGame.entry_fee),
              prizePool: parseFloat(newCashGame.prize_pool),
              maxEntries: newCashGame.max_entries,
              currentEntries: 0,
              maxEntriesPerUser: 1,
              playerBoard: newCashGame.player_board,
              startTime: newCashGame.start_time,
              endTime: newCashGame.end_time
            }
          });
        }
        
        return newCashGame;
      }

      return openCashGames[0];
    } catch (error) {
      console.error('Error ensuring cash game available:', error);
      throw error;
    }
  }

  // Clean up expired room boards
  async cleanupRoomBoards() {
    try {
      console.log('Cleaning up room boards...');
      
      // Clean up Redis keys for expired rooms
      const keys = await this.redis.keys('board:*');
      let cleaned = 0;
      
      for (const key of keys) {
        // Check if the room still has active entries
        const roomId = key.replace('ffsale:board:', '');
        const activeEntries = await db.ContestEntry.count({
          where: {
            draft_room_id: roomId,
            status: { [Op.in]: ['pending', 'drafting'] }
          }
        });
        
        // If no active entries, delete the board
        if (activeEntries === 0) {
          await this.redis.del(key.replace('ffsale:', ''));
          cleaned++;
        }
      }
      
      console.log(`Cleaned up ${cleaned} expired room boards`);
    } catch (error) {
      console.error('Error cleaning up room boards:', error);
    }
  }

  // Clean up expired locks
  async cleanupLocks() {
    try {
      console.log('Cleaning up expired locks...');
      
      // Clean up expired Redis locks
      const keys = await this.redis.keys('lock:*');
      let cleaned = 0;
      
      for (const key of keys) {
        // Get the lock value (timestamp when it expires)
        const lockValue = await this.redis.get(key.replace('ffsale:', ''));
        
        if (lockValue) {
          const expiryTime = parseInt(lockValue);
          
          // If the lock has expired, delete it
          if (Date.now() > expiryTime) {
            await this.redis.del(key.replace('ffsale:', ''));
            cleaned++;
          }
        }
      }
      
      console.log(`Cleaned up ${cleaned} expired locks`);
    } catch (error) {
      console.error('Error cleaning up locks:', error);
    }
  }

  // Health check method
  async healthCheck() {
    try {
      const checks = {
        database: false,
        redis: false,
        socketio: false
      };

      // Check database
      try {
        await db.sequelize.query('SELECT 1');
        checks.database = true;
      } catch (error) {
        console.error('Database health check failed:', error);
      }

      // Check Redis
      try {
        await this.redis.ping();
        checks.redis = true;
      } catch (error) {
        console.error('Redis health check failed:', error);
      }

      // Check Socket.IO
      checks.socketio = !!this.io;

      return checks;
    } catch (error) {
      console.error('Health check error:', error);
      return { error: error.message };
    }
  }

  // Cleanup method
  async cleanup() {
    try {
      await this.redis.quit();
      console.log('ContestService cleanup completed');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
}

// Create and export singleton instance
module.exports = new ContestService();