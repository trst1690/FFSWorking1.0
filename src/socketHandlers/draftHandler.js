// backend/src/socketHandlers/draftHandler.js
const contestService = require('../services/contestService');
const { getDraftState, updateDraftState } = require('../services/draftStateService');

class DraftHandler {
  constructor(io) {
    this.io = io;
    this.draftStates = new Map(); // In-memory draft states
    this.pickTimers = new Map();
  }

  handleConnection(socket, userId) {
    socket.on('join-draft', async (data) => {
      await this.handleJoinDraft(socket, userId, data);
    });

    socket.on('leave-draft', async (data) => {
      await this.handleLeaveDraft(socket, userId, data);
    });

    socket.on('request-draft-state', async (data) => {
      await this.sendDraftState(socket, data.roomId);
    });

    socket.on('make-pick', async (data) => {
      await this.handleMakePick(socket, userId, data);
    });
  }

  async handleJoinDraft(socket, userId, { roomId }) {
    try {
      // Join socket room
      socket.join(`draft_${roomId}`);
      
      // Get or create draft state
      let draftState = this.draftStates.get(roomId);
      if (!draftState) {
        draftState = await this.initializeDraftState(roomId);
        this.draftStates.set(roomId, draftState);
      }

      // Send current state to user
      socket.emit('draft-state-update', draftState);

      // Notify others
      socket.to(`draft_${roomId}`).emit('user-joined-draft', {
        userId,
        roomId
      });

      // Check if we should start draft
      await this.checkDraftStart(roomId);
    } catch (error) {
      console.error('Error joining draft:', error);
      socket.emit('draft-error', { message: error.message });
    }
  }

  async initializeDraftState(roomId) {
    const roomStatus = await contestService.getRoomStatus(roomId);
    if (!roomStatus) throw new Error('Room not found');

    return {
      roomId,
      contestId: roomStatus.contestId,
      status: 'waiting',
      playerBoard: roomStatus.playerBoard,
      users: roomStatus.entries,
      currentTurn: 0,
      picks: [],
      timeRemaining: 30,
      draftOrder: [],
      totalPlayers: roomStatus.maxPlayers,
      connectedPlayers: roomStatus.currentPlayers
    };
  }

  async checkDraftStart(roomId) {
    const draftState = this.draftStates.get(roomId);
    if (!draftState) return;

    const roomStatus = await contestService.getRoomStatus(roomId);
    
    if (roomStatus.currentPlayers >= roomStatus.maxPlayers && 
        draftState.status === 'waiting') {
      // Start countdown
      draftState.status = 'countdown';
      draftState.countdownTime = 5;
      
      // Create draft order
      draftState.draftOrder = this.createSnakeDraftOrder(roomStatus.entries);
      
      // Emit countdown
      this.io.to(`draft_${roomId}`).emit('countdown-started', {
        countdownTime: 5,
        users: roomStatus.entries,
        draftOrder: draftState.draftOrder
      });

      // Start countdown timer
      this.startCountdown(roomId);
    }
  }

  startCountdown(roomId) {
    let count = 5;
    const interval = setInterval(() => {
      count--;
      
      if (count > 0) {
        this.io.to(`draft_${roomId}`).emit('countdown-update', {
          countdownTime: count
        });
      } else {
        clearInterval(interval);
        this.startDraft(roomId);
      }
    }, 1000);
  }

  async startDraft(roomId) {
    const draftState = this.draftStates.get(roomId);
    if (!draftState) return;

    draftState.status = 'active';
    draftState.currentTurn = 0;
    draftState.timeRemaining = 30;

    // Emit draft started
    this.io.to(`draft_${roomId}`).emit('draft-started', draftState);

    // Start turn timer
    this.startTurnTimer(roomId);
  }

  startTurnTimer(roomId) {
    // Clear existing timer
    const existingTimer = this.pickTimers.get(roomId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    const timer = setInterval(() => {
      const draftState = this.draftStates.get(roomId);
      if (!draftState || draftState.status !== 'active') {
        clearInterval(timer);
        return;
      }

      draftState.timeRemaining--;
      
      // Emit timer update
      this.io.to(`draft_${roomId}`).emit('timer-update', draftState.timeRemaining);

      if (draftState.timeRemaining <= 0) {
        this.handleAutoPick(roomId);
      }
    }, 1000);

    this.pickTimers.set(roomId, timer);
  }

  async handleMakePick(socket, userId, { roomId, row, col, player }) {
    try {
      const draftState = this.draftStates.get(roomId);
      if (!draftState) throw new Error('Draft not found');

      // Validate it's user's turn
      const currentDrafter = draftState.users[draftState.draftOrder[draftState.currentTurn]];
      if (currentDrafter.userId !== userId) {
        throw new Error('Not your turn');
      }

      // Validate pick
      if (draftState.playerBoard[row][col].drafted) {
        throw new Error('Player already drafted');
      }

      // Make pick
      const pick = {
        userId,
        player,
        row,
        col,
        pickNumber: draftState.picks.length + 1,
        timestamp: new Date()
      };

      draftState.picks.push(pick);
      draftState.playerBoard[row][col].drafted = true;
      draftState.playerBoard[row][col].draftedBy = currentDrafter.draftPosition;

      // Emit pick made
      this.io.to(`draft_${roomId}`).emit('pick-made', {
        pick,
        currentTurn: draftState.currentTurn + 1,
        nextDrafter: draftState.draftOrder[draftState.currentTurn + 1]
      });

      // Move to next turn
      draftState.currentTurn++;
      draftState.timeRemaining = 30;

      // Check if draft complete
      if (draftState.currentTurn >= draftState.draftOrder.length) {
        await this.completeDraft(roomId);
      } else {
        this.startTurnTimer(roomId);
      }
    } catch (error) {
      console.error('Error making pick:', error);
      socket.emit('draft-error', { message: error.message });
    }
  }

  async completeDraft(roomId) {
    const draftState = this.draftStates.get(roomId);
    if (!draftState) return;

    // Clear timer
    const timer = this.pickTimers.get(roomId);
    if (timer) {
      clearInterval(timer);
      this.pickTimers.delete(roomId);
    }

    draftState.status = 'completed';

    // Save results to database
    await contestService.completeDraftForRoom(roomId, draftState);

    // Emit completion
    this.io.to(`draft_${roomId}`).emit('draft-completed', {
      roomId,
      results: draftState.picks
    });

    // Clean up after delay
    setTimeout(() => {
      this.draftStates.delete(roomId);
    }, 300000); // 5 minutes
  }

  createSnakeDraftOrder(users) {
    const order = [];
    const rounds = 5; // 5 rounds for 5 roster spots
    const numUsers = users.length;

    for (let round = 0; round < rounds; round++) {
      if (round % 2 === 0) {
        // Normal order
        for (let i = 0; i < numUsers; i++) {
          order.push(i);
        }
      } else {
        // Reverse order
        for (let i = numUsers - 1; i >= 0; i--) {
          order.push(i);
        }
      }
    }

    return order;
  }
}

module.exports = DraftHandler;