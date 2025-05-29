// backend/src/socketHandlers/index.js
const jwt = require('jsonwebtoken');
const contestService = require('../services/contestService');
const db = require('../models');

class SocketHandler {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map(); // userId -> Set of socketIds
    this.socketUsers = new Map(); // socketId -> userId
    this.roomParticipants = new Map(); // roomId -> Set of userIds
  }

  initialize() {
    // Set socket.io instance in contest service
    contestService.setSocketIO(this.io);

    this.io.on('connection', (socket) => {
      console.log('New socket connection:', socket.id);

      // Initial auth
      socket.on('authenticate', async (data) => {
        await this.handleAuthentication(socket, data);
      });

      // Join contest lobby
      socket.on('join-contest-lobby', (data) => {
        this.handleJoinContestLobby(socket, data);
      });

      // Leave contest lobby
      socket.on('leave-contest-lobby', (data) => {
        this.handleLeaveContestLobby(socket, data);
      });

      // Join draft room
      socket.on('join-room', (data) => {
        this.handleJoinRoom(socket, data);
      });

      // Leave draft room
      socket.on('leave-room', (data) => {
        this.handleLeaveRoom(socket, data);
      });

      // Join draft
      socket.on('join-draft', (data) => {
        this.handleJoinDraft(socket, data);
      });

      // Leave draft (but don't disconnect!)
      socket.on('leave-draft', (data) => {
        this.handleLeaveDraft(socket, data);
      });

      // Draft pick
      socket.on('make-pick', async (data) => {
        await this.handleMakePick(socket, data);
      });

      // Get room status
      socket.on('get-room-status', async (data) => {
        await this.handleGetRoomStatus(socket, data);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Keep-alive ping
      socket.on('ping', () => {
        socket.emit('pong', { timestamp: Date.now() });
      });

      // Error handler
      socket.on('error', (error) => {
        console.error('Socket error:', error);
      });
    });

    // Start periodic cleanup
    setInterval(() => {
      contestService.cleanupRoomBoards();
      contestService.cleanupLocks();
    }, 60000); // Every minute
  }

  async handleAuthentication(socket, data) {
    try {
      const { token } = data;
      if (!token) {
        socket.emit('auth-error', { error: 'No token provided' });
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await db.User.findByPk(decoded.userId);

      if (!user) {
        socket.emit('auth-error', { error: 'User not found' });
        return;
      }

      // Store user-socket mapping
      const userId = user.id;
      socket.userId = userId;
      socket.username = user.username;
      
      // Add to user sockets
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(socket.id);
      this.socketUsers.set(socket.id, userId);

      // Join user room for direct messaging
      socket.join(`user_${userId}`);

      console.log(`User ${user.username} authenticated (${socket.id})`);
      
      socket.emit('authenticated', {
        user: {
          id: user.id,
          username: user.username,
          balance: user.balance,
          tickets: user.tickets
        }
      });

      // Check for any active drafts
      const activeEntries = await db.ContestEntry.findAll({
        where: {
          user_id: userId,
          status: 'drafting'
        },
        include: [{
          model: db.Contest,
          attributes: ['id', 'name', 'type']
        }]
      });

      if (activeEntries.length > 0) {
        const entry = activeEntries[0];
        socket.emit('active-draft', {
          entryId: entry.id,
          draftRoomId: entry.draft_room_id,
          contestId: entry.contest_id,
          contestName: entry.Contest?.name
        });
      }

    } catch (error) {
      console.error('Authentication error:', error);
      socket.emit('auth-error', { error: 'Invalid token' });
    }
  }

  handleJoinContestLobby(socket, data) {
    const { contestId } = data;
    const userId = socket.userId;

    if (!userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const lobbyRoom = `contest_lobby_${contestId}`;
    socket.join(lobbyRoom);

    // Get current lobby participants
    const participants = this.getContestLobbyParticipants(contestId);

    // Send current state to joining user
    socket.emit('lobby-state', {
      contestId,
      participants: participants.length
    });

    // Notify others in lobby
    socket.to(lobbyRoom).emit('user-joined-lobby', {
      userId,
      username: socket.username,
      contestId,
      participants: participants.length + 1
    });

    console.log(`User ${socket.username} joined contest lobby ${contestId}`);
  }

  handleLeaveContestLobby(socket, data) {
    const { contestId } = data;
    const userId = socket.userId;

    if (!userId) return;

    const lobbyRoom = `contest_lobby_${contestId}`;
    socket.leave(lobbyRoom);

    const participants = this.getContestLobbyParticipants(contestId);

    socket.to(lobbyRoom).emit('user-left-lobby', {
      userId,
      contestId,
      participants: participants.length - 1
    });
  }

  async handleJoinRoom(socket, data) {
    const { roomId } = data;
    const userId = socket.userId;

    if (!userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    // Join socket room
    const socketRoom = `room_${roomId}`;
    socket.join(socketRoom);

    // Track room participants
    if (!this.roomParticipants.has(roomId)) {
      this.roomParticipants.set(roomId, new Set());
    }
    this.roomParticipants.get(roomId).add(userId);

    // Get current room status
    const roomStatus = await contestService.getRoomStatus(roomId);
    
    if (roomStatus) {
      // Send room state to joining user
      socket.emit('room-state', roomStatus);

      // Notify others in room
      socket.to(socketRoom).emit('user-joined-room', {
        userId,
        username: socket.username,
        roomId,
        currentPlayers: roomStatus.currentPlayers,
        maxPlayers: roomStatus.maxPlayers
      });

      console.log(`User ${socket.username} joined room ${roomId} (${roomStatus.currentPlayers}/${roomStatus.maxPlayers})`);
    }
  }

  handleLeaveRoom(socket, data) {
    const { roomId } = data;
    const userId = socket.userId;

    if (!userId) return;

    const socketRoom = `room_${roomId}`;
    socket.leave(socketRoom);

    // Remove from room participants
    if (this.roomParticipants.has(roomId)) {
      this.roomParticipants.get(roomId).delete(userId);
    }

    socket.to(socketRoom).emit('user-left-room', {
      userId,
      roomId
    });

    console.log(`User ${socket.username} left room ${roomId}`);
  }

  handleJoinDraft(socket, data) {
    const { draftId, roomId } = data;
    const userId = socket.userId;

    if (!userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const draftRoom = `draft_${draftId || roomId}`;
    socket.join(draftRoom);

    console.log(`User ${socket.username} joined draft ${draftId || roomId}`);

    // Send current draft state if available
    this.sendDraftState(socket, draftId || roomId);
  }

  handleLeaveDraft(socket, data) {
    const { draftId, roomId } = data;
    const userId = socket.userId;

    if (!userId) return;

    const draftRoom = `draft_${draftId || roomId}`;
    socket.leave(draftRoom);

    console.log(`User ${socket.username} left draft ${draftId || roomId} (but staying connected)`);
  }

  async handleMakePick(socket, data) {
    const { roomId, playerId, position, playerData } = data;
    const userId = socket.userId;

    if (!userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      // Process pick through contest service
      await contestService.handlePlayerPick(roomId, userId, playerData || { id: playerId }, position);
      
      socket.emit('pick-success', {
        playerId,
        position
      });
      
    } catch (error) {
      console.error('Error processing pick:', error);
      socket.emit('pick-error', { 
        error: error.message,
        playerId,
        position
      });
    }
  }

  async handleGetRoomStatus(socket, data) {
    const { roomId } = data;
    
    try {
      const roomStatus = await contestService.getRoomStatus(roomId);
      
      if (roomStatus) {
        socket.emit('room-status', roomStatus);
      } else {
        socket.emit('room-status-error', { 
          error: 'Room not found',
          roomId 
        });
      }
    } catch (error) {
      console.error('Error getting room status:', error);
      socket.emit('room-status-error', { 
        error: error.message,
        roomId 
      });
    }
  }

  handleDisconnect(socket) {
    const userId = this.socketUsers.get(socket.id);
    
    if (userId) {
      // Remove this specific socket
      const userSocketSet = this.userSockets.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        
        // Only log user as disconnected if they have no other sockets
        if (userSocketSet.size === 0) {
          this.userSockets.delete(userId);
          console.log(`User ${socket.username || userId} fully disconnected`);
          
          // Clean up room participants
          for (const [roomId, participants] of this.roomParticipants) {
            if (participants.has(userId)) {
              participants.delete(userId);
              
              // Notify room of disconnection
              this.io.to(`room_${roomId}`).emit('user-disconnected', {
                userId,
                roomId
              });
            }
          }
        } else {
          console.log(`User ${socket.username || userId} disconnected one socket, ${userSocketSet.size} remaining`);
        }
      }
      
      this.socketUsers.delete(socket.id);
    }

    console.log('Socket disconnected:', socket.id);
  }

  async sendDraftState(socket, roomId) {
    try {
      const activeDraft = contestService.activeDrafts.get(roomId);
      
      if (activeDraft) {
        socket.emit('draft-state', {
          roomId,
          currentTurn: activeDraft.currentTurn,
          picks: activeDraft.picks,
          participants: activeDraft.participants
        });
      }
    } catch (error) {
      console.error('Error sending draft state:', error);
    }
  }

  // Utility methods
  getContestLobbyParticipants(contestId) {
    const lobbyRoom = `contest_lobby_${contestId}`;
    const room = this.io.sockets.adapter.rooms.get(lobbyRoom);
    return room ? Array.from(room) : [];
  }

  getRoomParticipants(roomId) {
    const socketRoom = `room_${roomId}`;
    const room = this.io.sockets.adapter.rooms.get(socketRoom);
    return room ? Array.from(room) : [];
  }

  // Emit to specific user
  emitToUser(userId, event, data) {
    const userRoom = `user_${userId}`;
    this.io.to(userRoom).emit(event, data);
  }

  // Emit to room
  emitToRoom(roomId, event, data) {
    const socketRoom = `room_${roomId}`;
    this.io.to(socketRoom).emit(event, data);
  }

  // Emit to draft
  emitToDraft(draftId, event, data) {
    const draftRoom = `draft_${draftId}`;
    this.io.to(draftRoom).emit(event, data);
  }

  // Get online users count
  getOnlineUsersCount() {
    return this.userSockets.size;
  }

  // Get room participant count
  getRoomParticipantCount(roomId) {
    const participants = this.roomParticipants.get(roomId);
    return participants ? participants.size : 0;
  }
}

module.exports = SocketHandler;