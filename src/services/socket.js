// frontend/src/services/socket.js
import io from 'socket.io-client';
import { store } from '../store/store';
import { 
  updateDraftState, 
  updateTimer, 
  addPick,
  setMyTurn 
} from '../store/slices/draftSlice';
import { setSocketStatus } from '../store/slices/socketSlice';

class SocketService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempts = 0;
    this.listeners = new Map();
    this.reduxHandlers = new Map();
    this.connectionPromise = null;
    this.authToken = null;
  }

  connect(token) {
    // Store token for reconnection attempts
    this.authToken = token;
    
    // If already connecting or connected, return existing promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    if (this.socket?.connected && this.authenticated) {
      return Promise.resolve(this.socket);
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      console.log('🔌 Initiating socket connection...');
      
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
      
      // Disconnect any existing socket first
      if (this.socket) {
        this.cleanup();
      }

      // Create socket with authentication token
      this.socket = io(API_URL, {
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        timeout: 10000,
        transports: ['websocket', 'polling']
      });

      const connectionTimeout = setTimeout(() => {
        this.connectionPromise = null;
        reject(new Error('Socket connection timeout'));
      }, 15000);

      // Core event handlers - register ONCE
      this.socket.once('connect', () => {
        console.log('✅ Socket connected:', this.socket.id);
        this.connected = true;
        this.reconnectAttempts = 0;
        clearTimeout(connectionTimeout);
        
        store.dispatch(setSocketStatus({ 
          connected: true, 
          authenticated: false,
          socketId: this.socket.id 
        }));
        
        // Set up persistent handlers
        this.setupCoreHandlers();
        this.setupReduxHandlers();
        
        // The backend should automatically authenticate us via the auth token
        // But if it doesn't, we'll wait for the authenticated event
        console.log('Waiting for authentication confirmation...');
      });

      this.socket.once('authenticated', (data) => {
        console.log('✅ Socket authenticated:', data);
        this.authenticated = true;
        this.connectionPromise = null;
        
        store.dispatch(setSocketStatus({ 
          connected: true, 
          authenticated: true,
          userId: data.user?.id || data.userId,
          username: data.user?.username
        }));
        
        resolve(this.socket);
      });

      this.socket.once('auth-error', (error) => {
        console.error('❌ Socket authentication failed:', error);
        this.authenticated = false;
        this.connectionPromise = null;
        clearTimeout(connectionTimeout);
        reject(new Error(error.message || 'Authentication failed'));
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ Socket connection error:', error.message);
        if (!this.connected) {
          clearTimeout(connectionTimeout);
          this.connectionPromise = null;
          reject(error);
        }
      });
    });

    return this.connectionPromise;
  }

  setupCoreHandlers() {
    // Remove all existing listeners first
    this.socket.removeAllListeners('disconnect');
    this.socket.removeAllListeners('reconnect');
    this.socket.removeAllListeners('reconnect_attempt');
    this.socket.removeAllListeners('error');
    
    // Enhanced disconnect handler
    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
      this.connected = false;
      this.authenticated = false;
      
      store.dispatch(setSocketStatus({ 
        connected: false, 
        authenticated: false,
        disconnectReason: reason 
      }));
      
      // Clear connection promise so reconnection can work
      this.connectionPromise = null;
    });

    // Reconnection handlers
    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts`);
      this.connected = true;
      
      store.dispatch(setSocketStatus({ 
        connected: true, 
        authenticated: false,
        reconnectAttempts: attemptNumber 
      }));
      
      // After reconnection, we should be automatically authenticated via the auth token
      // The backend should emit 'authenticated' event
    });

    this.socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}`);
      this.reconnectAttempts = attemptNumber;
    });

    // Enhanced error handler
    this.socket.on('error', (error) => {
      console.error('❌ Socket error:', error);
      
      // Check if it's an authentication error
      if (error.message === 'Not authenticated' || 
          error.type === 'UnauthorizedError' || 
          error.message === 'Authentication required') {
        console.log('Socket requires authentication, attempting to authenticate...');
        
        // If we have a token, try to authenticate
        if (this.authToken) {
          console.log('Sending manual authentication with stored token');
          this.socket.emit('authenticate', { token: this.authToken });
        } else {
          // Try to get token from localStorage
          const token = localStorage.getItem('token');
          if (token) {
            console.log('Sending manual authentication with localStorage token');
            this.socket.emit('authenticate', { token });
            this.authToken = token;
          } else {
            console.error('No token available for authentication');
          }
        }
      }
    });

    // Development logging
    if (process.env.NODE_ENV === 'development') {
      this.socket.onAny((event, ...args) => {
        // Skip duplicate log for registered events
        if (!this.reduxHandlers.has(event) && !this.listeners.has(event)) {
          console.log(`📨 Socket event: ${event}`, args);
        }
      });
    }
  }

  setupReduxHandlers() {
    // Clear existing Redux handlers
    this.reduxHandlers.forEach((handler, event) => {
      this.socket.off(event, handler);
    });
    this.reduxHandlers.clear();

    // Define Redux-connected handlers
    const handlers = {
      'draft-state-update': (state) => {
        console.log('📨 Redux event: draft-state-update', state);
        store.dispatch(updateDraftState(state));
      },
      'timer-update': (time) => {
        store.dispatch(updateTimer(time));
      },
      'pick-made': (data) => {
        console.log('📨 Redux event: pick-made', data);
        store.dispatch(addPick(data));
      },
      'turn-update': (data) => {
        const state = store.getState();
        const isMyTurn = data.currentDrafterPosition === state.draft.userDraftPosition;
        store.dispatch(setMyTurn(isMyTurn));
      },
      'draft-started': (data) => {
        console.log('📨 Redux event: draft-started', data);
        store.dispatch(updateDraftState({
          status: 'active',
          ...data
        }));
      },
      'draft-completed': (data) => {
        console.log('📨 Redux event: draft-completed', data);
        store.dispatch(updateDraftState({
          status: 'completed',
          results: data.results
        }));
      },
      'countdown-started': (data) => {
        console.log('📨 Redux event: countdown-started', data);
        store.dispatch(updateDraftState({
          status: 'countdown',
          countdownTime: data.countdownTime,
          users: data.users,
          draftOrder: data.draftOrder
        }));
      },
      'countdown-update': (data) => {
        store.dispatch(updateDraftState({
          countdownTime: data.countdownTime
        }));
      }
    };

    // Register each handler
    Object.entries(handlers).forEach(([event, handler]) => {
      this.reduxHandlers.set(event, handler);
      this.socket.on(event, handler);
    });
  }

  emit(event, data) {
    if (this.socket && this.connected) {
      console.log(`📤 Emitting: ${event}`, data);
      this.socket.emit(event, data);
      return true;
    } else {
      console.warn(`⏳ Socket not connected, cannot emit: ${event}`);
      return false;
    }
  }

  on(event, callback) {
    // Prevent duplicate listeners
    if (this.listeners.has(event)) {
      console.warn(`⚠️ Listener already exists for event: ${event}, replacing...`);
      this.off(event);
    }
    
    this.listeners.set(event, callback);
    
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event, callback) {
    if (this.socket) {
      if (callback) {
        this.socket.off(event, callback);
      } else {
        this.socket.off(event);
      }
    }
    
    this.listeners.delete(event);
  }

  once(event, callback) {
    if (this.socket) {
      this.socket.once(event, callback);
    }
  }

  // Manual authentication method (if needed)
  authenticate(token) {
    if (!token) {
      token = this.authToken || localStorage.getItem('token');
    }
    
    if (token && this.socket && this.connected) {
      console.log('Manually authenticating socket...');
      this.authToken = token;
      this.socket.emit('authenticate', { token });
      return true;
    }
    
    console.warn('Cannot authenticate: no token or socket not connected');
    return false;
  }

  // Room management
  joinRoom(roomId, data = {}) {
    return this.emit('join-room', { roomId, ...data });
  }

  leaveRoom(roomId, data = {}) {
    return this.emit('leave-room', { roomId, ...data });
  }

  // Draft management
  joinDraft(contestId, entryId) {
    return this.emit('join-draft', { contestId, entryId });
  }

  leaveDraft(contestId, entryId) {
    return this.emit('leave-draft', { contestId, entryId });
  }

  makePick(row, col, player, rosterSlot) {
    return this.emit('make-pick', { row, col, player, rosterSlot });
  }

  skipTurn(reason = 'no_budget') {
    return this.emit('skip-turn', { reason });
  }

  // Clean up
  cleanup() {
    console.log('🧹 Cleaning up socket service');
    
    // Remove all listeners
    this.listeners.forEach((callback, event) => {
      this.socket?.off(event, callback);
    });
    this.listeners.clear();
    
    // Remove Redux handlers
    this.reduxHandlers.forEach((handler, event) => {
      this.socket?.off(event, handler);
    });
    this.reduxHandlers.clear();
    
    // Disconnect socket
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Reset state
    this.connected = false;
    this.authenticated = false;
    this.connectionPromise = null;
    this.authToken = null;
    
    store.dispatch(setSocketStatus({ 
      connected: false, 
      authenticated: false 
    }));
  }

  // Utility methods
  isConnected() {
    return this.connected && this.socket?.connected;
  }

  isAuthenticated() {
    return this.authenticated;
  }

  getSocket() {
    return this.socket;
  }

  getConnectionState() {
    return {
      connected: this.connected,
      authenticated: this.authenticated,
      reconnectAttempts: this.reconnectAttempts,
      socketId: this.socket?.id
    };
  }
}

// Create singleton instance
const socketService = new SocketService();

// Auto-cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    socketService.cleanup();
  });
}

export default socketService;