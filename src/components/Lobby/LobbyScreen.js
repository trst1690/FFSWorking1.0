// frontend/src/components/Lobby/LobbyScreen.js
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import socketService from '../../services/socket';
import { showToast as showToastAction } from '../../store/slices/uiSlice';
import { selectAuthUser } from '../../store/slices/authSlice';
import './Lobby.css';

// Constants
const REFRESH_INTERVAL = 30000; // 30 seconds
const CONTEST_TYPES = {
  ALL: 'all',
  CASH: 'cash',
  BASH: 'bash',
  MARKET: 'market',
  FIRESALE: 'firesale'
};

const FILTER_TYPES = {
  ALL: 'all',
  OPEN: 'open',
  ENTERED: 'entered'
};

// Contest Card Component
const ContestCard = React.memo(({ 
  contest, 
  userEntry, 
  onEnter, 
  onWithdraw, 
  onMarketMover,
  onRejoinDraft,
  isEntering, 
  isWithdrawing,
  userBalance 
}) => {
  const currentEntries = contest.currentEntries || 0;
  const maxEntries = contest.maxEntries || 5;
  const entryFee = parseFloat(contest.entryFee) || 0;
  const canAfford = userBalance >= entryFee;
  
  // For cash games, show simple entries. For tournaments, show room/total
  const isCashGame = contest.type === 'cash';
  const roomSize = 5; // All rooms have 5 players
  const totalRooms = isCashGame ? 1 : Math.ceil(maxEntries / roomSize);
  const filledRooms = isCashGame ? 0 : Math.floor(currentEntries / roomSize);
  const currentRoomEntries = isCashGame ? currentEntries : (currentEntries % roomSize);
  
  // Calculate fill percentage
  const fillPercentage = isCashGame 
    ? (currentEntries / roomSize) * 100
    : (currentRoomEntries / roomSize) * 100;
    
  const isFull = isCashGame 
    ? currentEntries >= maxEntries
    : currentEntries >= maxEntries;
  
  // Determine button state
  const getButtonConfig = () => {
    if (contest.status !== 'open') {
      return {
        text: contest.status === 'closed' ? 'Closed' : 'In Progress',
        disabled: true,
        action: null,
        className: 'btn-disabled'
      };
    }

    if (userEntry) {
      if (userEntry.status === 'drafting') {
        return {
          text: 'Rejoin Draft',
          disabled: false,
          action: () => onRejoinDraft(contest, userEntry),
          className: 'btn-enter btn-pulse'
        };
      }
      
      if (userEntry.status === 'pending') {
        return {
          text: isWithdrawing ? 'Withdrawing...' : 'Withdraw',
          disabled: isWithdrawing,
          action: () => onWithdraw(userEntry.id),
          className: 'btn-withdraw'
        };
      }
      
      return {
        text: 'Entered',
        disabled: true,
        action: null,
        className: 'btn-disabled'
      };
    }

    if (isFull) {
      return {
        text: 'Full',
        disabled: true,
        action: null,
        className: 'btn-disabled'
      };
    }

    return {
      text: isEntering ? 'Entering...' : entryFee === 0 ? 'Enter FREE' : `Enter ($${entryFee.toFixed(2)})`,
      disabled: isEntering || !canAfford,
      action: () => onEnter(contest.id, contest),
      className: !canAfford ? 'btn-disabled' : 'btn-enter',
      tooltip: !canAfford ? `Need $${entryFee.toFixed(2)} to enter` : null
    };
  };

  const buttonConfig = getButtonConfig();

  return (
    <div className={`contest-card ${contest.type} ${userEntry ? 'user-entered' : ''} ${isFull ? 'contest-full' : ''}`}>
      <div className="contest-header">
        <h3>{contest.name || `Contest ${contest.id?.substring(0, 8) || ''}`}</h3>
        <span className={`contest-type ${contest.type}`}>
          {contest.type.toUpperCase()}
        </span>
      </div>
      
      <div className="contest-details">
        <div className="detail-row">
          <span className="detail-label">Entry Fee:</span>
          <span className="detail-value">
            {entryFee === 0 ? (
              <span className="free-entry">FREE</span>
            ) : (
              `$${entryFee.toFixed(2)}`
            )}
          </span>
        </div>
        
        <div className="detail-row">
          <span className="detail-label">
            {isCashGame ? 'Entries:' : 'Room:'}
          </span>
          <span className="detail-value">
            {isCashGame 
              ? `${currentEntries}/${roomSize}`
              : `${currentRoomEntries}/5`
            }
            {userEntry && <span className="user-entered-indicator"> ✓</span>}
          </span>
        </div>
        
        {!isCashGame && (
          <div className="detail-row">
            <span className="detail-label">Total Entries:</span>
            <span className="detail-value">
              {currentEntries}/{maxEntries}
              <span className="rooms-info"> ({filledRooms}/{totalRooms} rooms)</span>
            </span>
          </div>
        )}
        
        <div className="detail-row">
          <span className="detail-label">Prize Pool:</span>
          <span className="detail-value prize-pool">
            ${parseFloat(contest.prizePool || 0).toLocaleString()}
          </span>
        </div>
        
        <div className="detail-row">
          <span className="detail-label">Status:</span>
          <span className={`status ${contest.status}`}>
            {isFull && contest.status === 'open' ? 'FULL' : contest.status.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="contest-progress">
        <div className={`fill-bar ${fillPercentage >= 100 ? 'full' : ''}`}>
          <div 
            className="fill-progress"
            style={{ width: `${Math.min(100, fillPercentage)}%` }}
          />
        </div>
        <span className="progress-text">
          {isCashGame 
            ? `${fillPercentage.toFixed(0)}% Full`
            : `Room ${fillPercentage.toFixed(0)}% Full`
          }
        </span>
      </div>

      <div className="contest-actions">
        {contest.type === 'market' && (
          <button
            className="btn btn-secondary"
            onClick={() => onMarketMover(contest)}
            disabled={!userEntry}
            title={!userEntry ? 'Enter contest first to access Market Mover tools' : ''}
          >
            Market Tools
          </button>
        )}
        <button
          className={`btn ${buttonConfig.className}`}
          onClick={buttonConfig.action}
          disabled={buttonConfig.disabled}
          title={buttonConfig.tooltip}
        >
          {buttonConfig.text}
        </button>
      </div>
    </div>
  );
});

// Main LobbyScreen Component
const LobbyScreen = ({ onEnterContest, updateBalance }) => {
  // Add Redux hooks
  const dispatch = useDispatch();
  const user = useSelector(selectAuthUser);
  
  // Create a showToast wrapper that works like the old prop version
  const showToast = useCallback((message, type = 'info') => {
    dispatch(showToastAction({ message, type }));
  }, [dispatch]);
  
  // State management - grouped related states
  const [data, setData] = useState({
    contests: [],
    userEntries: [],
    loading: true
  });
  
  const [filters, setFilters] = useState({
    type: CONTEST_TYPES.ALL,
    status: FILTER_TYPES.ALL
  });
  
  const [actions, setActions] = useState({
    enteringContest: null,
    withdrawingEntry: null
  });
  
  const [socketStatus, setSocketStatus] = useState({
    connected: false,
    authenticated: false,
    userId: null
  });
  
  // Refs for preventing multiple fetches and tracking component mount
  const isFetchingRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshIntervalRef = useRef(null);
  const draftNavigationRef = useRef(false);
  const joinedRoomsRef = useRef(new Set());
  
  // New refs for improved socket management
  const socketInitializedRef = useRef(false);
  const socketListenersRegisteredRef = useRef(false);
  const activeRoomRef = useRef(null);
  const pendingRoomJoinsRef = useRef(new Set());
  
  const navigate = useNavigate();

  // Configure axios on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    
    // Clear any stale draft data when mounting lobby
    sessionStorage.removeItem('currentDraft');
    sessionStorage.removeItem('currentContest');
    sessionStorage.removeItem('currentEntry');
    
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
    };
  }, []);

  // Memoized fetch functions
  const fetchContests = useCallback(async () => {
    if (isFetchingRef.current || !mountedRef.current) return;
    
    isFetchingRef.current = true;
    
    try {
      const response = await axios.get('/api/contests');
      
      if (mountedRef.current) {
        setData(prev => ({
          ...prev,
          contests: Array.isArray(response.data) ? response.data : [],
          loading: false
        }));
      }
    } catch (error) {
      console.error('Error fetching contests:', error);
      
      if (mountedRef.current) {
        if (error.response?.status !== 401) {
          showToast('Failed to load contests', 'error');
        }
        setData(prev => ({ ...prev, loading: false }));
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [showToast]);

  // Improved fetchUserEntries with better room join management
  const fetchUserEntries = useCallback(async () => {
    if (!user || !mountedRef.current) return;
    
    try {
      const response = await axios.get('/api/contests/my-entries');
      
      if (mountedRef.current) {
        const entries = response.data || [];
        setData(prev => ({
          ...prev,
          userEntries: entries
        }));
        
        // Only join rooms for active drafts that we haven't already joined
        entries.forEach(entry => {
          if (entry.status === 'drafting' && entry.draftRoomId) {
            // Check if we're already in this room or trying to join it
            if (!joinedRoomsRef.current.has(entry.draftRoomId) && 
                !pendingRoomJoinsRef.current.has(entry.draftRoomId)) {
              console.log('Auto-joining draft room:', entry.draftRoomId);
              pendingRoomJoinsRef.current.add(entry.draftRoomId);
              
              socketService.emit('join-room', { 
                roomId: entry.draftRoomId,
                userId: user.id
              });
            }
          }
        });
      }
    } catch (error) {
      if (error.response?.status !== 401 && mountedRef.current) {
        console.error('Error fetching user entries:', error);
      }
    }
  }, [user]);

  // Combined data fetch
  const fetchAllData = useCallback(async () => {
    await Promise.all([fetchContests(), fetchUserEntries()]);
  }, [fetchContests, fetchUserEntries]);

  // Improved socket initialization
  const initializeSocket = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !user) {
      console.log('No token or user available for socket connection');
      return;
    }

    // Prevent multiple initializations
    if (socketInitializedRef.current) {
      console.log('Socket already initialized');
      return;
    }

    try {
      console.log('Initializing socket connection...');
      
      // Connect and authenticate in one go
      await socketService.connect(token);
      
      socketInitializedRef.current = true;
      console.log('Socket initialized successfully');
      
    } catch (error) {
      console.error('Socket initialization error:', error);
      socketInitializedRef.current = false;
    }
  }, [user]);

  // Consolidated socket event handlers
  useEffect(() => {
    if (!user || socketListenersRegisteredRef.current) return;

    console.log('Setting up socket event listeners...');

    const handleSocketConnect = () => {
      console.log('Socket connected in lobby');
      setSocketStatus(prev => ({ ...prev, connected: true }));
    };

    const handleSocketDisconnect = () => {
      console.log('Socket disconnected in lobby');
      setSocketStatus(prev => ({ 
        ...prev, 
        connected: false, 
        authenticated: false 
      }));
      socketInitializedRef.current = false;
      socketListenersRegisteredRef.current = false;
      joinedRoomsRef.current.clear();
      activeRoomRef.current = null;
      
      // Attempt reconnection after delay
      setTimeout(() => {
        initializeSocket();
      }, 3000);
    };

    const handleAuthenticated = (data) => {
      console.log('Socket authenticated:', data);
      setSocketStatus(prev => ({ 
        ...prev, 
        authenticated: true,
        userId: data.user?.id || data.userId 
      }));
      
      // After authentication, fetch user entries to rejoin any active drafts
      fetchUserEntries();
    };

    const handleAuthError = (error) => {
      console.error('Socket authentication error:', error);
      setSocketStatus(prev => ({ 
        ...prev, 
        authenticated: false 
      }));
      showToast('Socket authentication failed', 'error');
    };

    const handleActiveDraft = (data) => {
      console.log('Active draft found:', data);
      
      if (!data.draftRoomId || !data.entryId) {
        console.warn('Active draft missing required data, ignoring');
        return;
      }
      
      if (draftNavigationRef.current) {
        console.log('Already navigating to draft, ignoring active draft');
        return;
      }
      
      const confirmRejoin = window.confirm(
        `You have an active draft in ${data.contestName || 'a contest'}. Would you like to rejoin?`
      );
      
      if (confirmRejoin) {
        showToast('Rejoining active draft...', 'info');
        
        sessionStorage.setItem('currentDraft', JSON.stringify({
          entryId: data.entryId,
          draftRoomId: data.draftRoomId,
          contestId: data.contestId,
          contestName: data.contestName
        }));
        
        draftNavigationRef.current = true;
        navigate(`/draft/${data.draftRoomId}`);
        
        setTimeout(() => {
          draftNavigationRef.current = false;
        }, 2000);
      }
    };

    const handleContestUpdate = (data) => {
      console.log('Contest update received:', data);
      
      if (data.contest) {
        setData(prev => ({
          ...prev,
          contests: prev.contests.map(c => 
            c.id === data.contest.id ? { ...c, ...data.contest } : c
          )
        }));
      } else {
        fetchContests();
      }
    };

    const handleContestCreated = (data) => {
      console.log('New contest created:', data);
      
      if (data.contest) {
        setData(prev => {
          const exists = prev.contests.some(c => c.id === data.contest.id);
          if (exists) {
            return {
              ...prev,
              contests: prev.contests.map(c => 
                c.id === data.contest.id ? data.contest : c
              )
            };
          }
          
          if (data.replacedContestId) {
            return {
              ...prev,
              contests: prev.contests
                .filter(c => c.id !== data.replacedContestId)
                .concat(data.contest)
            };
          }
          
          return {
            ...prev,
            contests: [...prev.contests, data.contest]
          };
        });
        
        if (data.message) {
          showToast(data.message, 'info');
        }
      }
    };

    const handleJoinedRoom = (data) => {
      console.log('✅ Successfully joined room:', data);
      joinedRoomsRef.current.add(data.roomId);
      pendingRoomJoinsRef.current.delete(data.roomId);
      
      if (data.message) {
        showToast(data.message, 'success');
      }
    };

    const handleRoomState = (data) => {
      console.log('Room state received:', data);
      // Only process room state once per room
      if (activeRoomRef.current === data.roomId) {
        console.log('Already processed room state for this room');
        return;
      }
      activeRoomRef.current = data.roomId;
    };

    const handleRoomError = (error) => {
      console.error('Room error:', error);
      if (error.roomId) {
        pendingRoomJoinsRef.current.delete(error.roomId);
      }
      showToast(error.message || 'Failed to join room', 'error');
    };

    const handleCountdownStarted = (data) => {
      console.log('Countdown started:', data);
      showToast('Draft countdown has begun! Get ready...', 'info');
      
      if (data.users && data.draftOrder) {
        const currentUser = data.users.find(u => u.userId === user.id);
        if (currentUser && !draftNavigationRef.current) {
          const userEntry = data.userEntries?.find(e => e.userId === user.id) || 
                           { draftRoomId: data.roomId || data.contestId };
          
          const draftData = {
            roomId: userEntry.draftRoomId || data.roomId || data.contestId,
            contestId: data.contestId,
            entryId: userEntry.id || currentUser.entryId,
            users: data.users,
            draftOrder: data.draftOrder,
            userDraftPosition: currentUser.position,
            status: 'countdown'
          };
          
          sessionStorage.setItem('currentDraft', JSON.stringify(draftData));
          
          draftNavigationRef.current = true;
          navigate(`/draft/${draftData.roomId}`);
          
          setTimeout(() => {
            draftNavigationRef.current = false;
          }, 2000);
        }
      }
    };

    const handleDraftStarted = (data) => {
      console.log('Draft started event:', data);
      
      if (!draftNavigationRef.current && data.users) {
        const currentUser = data.users.find(u => u.userId === user.id);
        
        if (currentUser) {
          draftNavigationRef.current = true;
          
          const draftData = {
            roomId: data.roomId || currentUser.entryId,
            contestId: data.contestId,
            entryId: currentUser.entryId,
            playerBoard: data.playerBoard,
            draftOrder: data.draftOrder,
            users: data.users,
            userDraftPosition: currentUser.position,
            status: 'active'
          };
          
          sessionStorage.setItem('currentDraft', JSON.stringify(draftData));
          
          showToast('Draft has started! Redirecting...', 'success');
          navigate(`/draft/${draftData.roomId}`);
          
          setTimeout(() => {
            draftNavigationRef.current = false;
          }, 2000);
        }
      }
    };

    const handleDraftStarting = (data) => {
      console.log('🚀 DRAFT STARTING EVENT RECEIVED!', data);
      
      if (draftNavigationRef.current) {
        console.log('Already navigating to draft, ignoring duplicate event');
        return;
      }
      
      draftNavigationRef.current = true;
      showToast('Draft is starting! Redirecting...', 'success');
      
      const userEntry = data.participants?.find(p => p.userId === user.id);
      
      const contestData = {
        roomId: data.roomId,
        contestId: data.contestId,
        entryId: userEntry?.id || data.entryId,
        playerBoard: data.playerBoard,
        participants: data.participants,
        contestType: data.contestType || 'cash',
        currentPickNumber: data.currentPickNumber || 1,
        currentPickerIndex: data.currentPickerIndex || 0,
        userDraftPosition: userEntry?.draftPosition
      };
      
      sessionStorage.setItem('currentDraft', JSON.stringify(contestData));
      
      console.log('Navigating to draft:', `/draft/${data.roomId}`);
      navigate(`/draft/${data.roomId}`);
      
      setTimeout(() => {
        draftNavigationRef.current = false;
      }, 2000);
    };

    const handleDraftCountdown = (data) => {
      console.log('Draft countdown:', data);
      showToast(`Draft starting in ${data.seconds} seconds...`, 'info');
    };

    const handleUserJoined = (data) => {
      console.log('User joined room:', data);
      
      if (data.roomId && data.currentPlayers !== undefined) {
        setData(prev => ({
          ...prev,
          contests: prev.contests.map(c => {
            if (c.id === data.roomId && c.type === 'cash') {
              return { ...c, currentEntries: data.currentPlayers };
            }
            return c;
          })
        }));
      }
    };

    const handleUserLeft = (data) => {
      console.log('User left room:', data);
      
      if (data.roomId && data.currentPlayers !== undefined) {
        setData(prev => ({
          ...prev,
          contests: prev.contests.map(c => {
            if (c.id === data.roomId && c.type === 'cash') {
              return { ...c, currentEntries: data.currentPlayers };
            }
            return c;
          })
        }));
      }
    };

    const handleDraftStateUpdate = (data) => {
      console.log('Draft state update:', data);
      
      if ((data.status === 'active' || data.status === 'countdown') && 
          data.users && data.draftOrder && !draftNavigationRef.current) {
        const storedEntry = JSON.parse(sessionStorage.getItem('currentEntry') || '{}');
        const roomId = data.roomId || storedEntry.roomId;
        
        if (roomId) {
          console.log('Active draft with users detected, navigating...');
          draftNavigationRef.current = true;
          
          const draftData = {
            ...data,
            roomId: roomId,
            entryId: storedEntry.entryId || data.entryId
          };
          sessionStorage.setItem('currentDraft', JSON.stringify(draftData));
          
          navigate(`/draft/${roomId}`);
          
          setTimeout(() => {
            draftNavigationRef.current = false;
          }, 2000);
        }
      }
    };

    // Initialize socket
    initializeSocket();
    
    // Register event listeners ONCE
    const events = {
      'connect': handleSocketConnect,
      'disconnect': handleSocketDisconnect,
      'authenticated': handleAuthenticated,
      'auth-error': handleAuthError,
      'active-draft': handleActiveDraft,
      'contest-updated': handleContestUpdate,
      'contest-created': handleContestCreated,
      'draft-starting': handleDraftStarting,
      'draft-started': handleDraftStarted,
      'draft-countdown': handleDraftCountdown,
      'countdown-started': handleCountdownStarted,
      'joined-room': handleJoinedRoom,
      'room-state': handleRoomState,
      'room-error': handleRoomError,
      'user-joined': handleUserJoined,
      'user-left': handleUserLeft,
      'draft-state-update': handleDraftStateUpdate
    };

    Object.entries(events).forEach(([event, handler]) => {
      socketService.on(event, handler);
    });

    socketListenersRegisteredRef.current = true;

    // Check initial connection state
    setSocketStatus(prev => ({ 
      ...prev, 
      connected: socketService.isConnected(),
      authenticated: socketService.isAuthenticated()
    }));

    // Cleanup
    return () => {
      console.log('Cleaning up socket listeners');
      Object.entries(events).forEach(([event]) => {
        socketService.off(event);
      });
      socketListenersRegisteredRef.current = false;
    };
  }, [user, initializeSocket, fetchUserEntries, fetchContests, showToast, navigate]);

  // Initial data load and refresh interval
  useEffect(() => {
    mountedRef.current = true;
    
    // Initial fetch
    fetchAllData();
    
    // Set up refresh interval
    refreshIntervalRef.current = setInterval(() => {
      if (mountedRef.current && !isFetchingRef.current) {
        fetchAllData();
      }
    }, REFRESH_INTERVAL);
    
    return () => {
      mountedRef.current = false;
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [fetchAllData]);

  // Improved contest entry handler
  const handleEnterContest = useCallback(async (contestId, contest) => {
    if (!user) {
      showToast('Please log in to enter contests', 'error');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      showToast('Authentication required', 'error');
      return;
    }

    // Ensure socket is connected
    if (!socketService.isConnected()) {
      showToast('Connecting to server...', 'info');
      await initializeSocket();
      
      // Wait a moment for connection
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (!socketService.isConnected()) {
        showToast('Unable to connect to server. Please try again.', 'error');
        return;
      }
    }

    setActions(prev => ({ ...prev, enteringContest: contestId }));

    try {
      const response = await axios.post(`/api/contests/enter/${contestId}`);
      
      if (response.data.success) {
        showToast(`Successfully entered ${contest.name}!`, 'success');
        
        // Update balance if provided
        if (response.data.newBalance !== undefined && updateBalance) {
          updateBalance(response.data.newBalance);
        }
        
        // Extract room and entry data
        const roomId = response.data.entry?.draftRoomId || response.data.draftRoomId || response.data.roomId;
        const entryId = response.data.entry?.id || response.data.entryId;
        
        console.log('Contest entry response:', {
          roomId,
          entryId,
          contestFull: response.data.contestFull,
          entry: response.data.entry
        });
        
        // Optimistic update
        setData(prev => ({
          ...prev,
          contests: prev.contests.map(c => 
            c.id === contestId 
              ? { ...c, currentEntries: (c.currentEntries || 0) + 1 }
              : c
          ),
          userEntries: [...prev.userEntries, {
            id: entryId,
            contestId: contestId,
            status: 'pending',
            draftRoomId: roomId
          }]
        }));
        
        // Join socket room only if we haven't already
        if (roomId && socketService.isConnected() && 
            !joinedRoomsRef.current.has(roomId) && 
            !pendingRoomJoinsRef.current.has(roomId)) {
          console.log('Joining socket room:', roomId);
          pendingRoomJoinsRef.current.add(roomId);
          
          socketService.emit('join-room', { 
            roomId: roomId,
            contestId: contestId,
            userId: user.id,
            entryId: entryId
          });
        }
        
        // Store contest data
        const contestData = {
          contestId: contestId,
          contestType: contest.type,
          contestName: contest.name,
          entryId: entryId,
          draftRoomId: roomId,
          playerBoard: contest.playerBoard,
          maxEntries: contest.maxEntries,
          entry: response.data.entry,
          roomId: roomId
        };
        
        sessionStorage.setItem('currentContest', JSON.stringify(contestData));
        sessionStorage.setItem('currentEntry', JSON.stringify({
          entryId: entryId,
          contestId: contestId,
          roomId: roomId
        }));
        
        // For cash games, check if contest is full
        if (contest.type === 'cash' && response.data.contestFull) {
          showToast('Contest full! Draft will start in 5 seconds...', 'info');
          console.log('Cash game full, waiting for draft events...');
          
          // Emit join-draft after a short delay
          setTimeout(() => {
            if (entryId && contestId) {
              console.log('Emitting join-draft for full cash game:', {
                contestId: contestId,
                entryId: entryId
              });
              
              socketService.emit('join-draft', {
                contestId: contestId,
                entryId: entryId
              });
            }
          }, 1000);
        }
        
        // For tournament contests, show room status
        if (contest.type !== 'cash' && response.data.entry) {
          const roomSize = 5;
          const roomEntries = ((contest.currentEntries + 1) % roomSize) || roomSize;
          if (roomEntries < roomSize) {
            showToast(`Joined room! Waiting for ${roomSize - roomEntries} more players...`, 'info');
          } else {
            showToast('Room full! Draft will start soon...', 'info');
          }
        }
        
        // Refresh data in background
        setTimeout(() => fetchAllData(), 1000);
      }
    } catch (error) {
      console.error('Error entering contest:', error);
      console.error('Error response:', error.response?.data);
      const errorMessage = error.response?.data?.error || 'Failed to enter contest';
      showToast(errorMessage, 'error');
      
      // Refresh data to ensure consistency
      fetchAllData();
    } finally {
      setActions(prev => ({ ...prev, enteringContest: null }));
    }
  }, [user, showToast, updateBalance, fetchAllData, initializeSocket]);

  // Withdraw handler
  const handleWithdrawContest = useCallback(async (entryId) => {
    if (!user) {
      showToast('Please log in to withdraw', 'error');
      return;
    }

    const confirmWithdraw = window.confirm('Are you sure you want to withdraw from this contest?');
    if (!confirmWithdraw) return;

    setActions(prev => ({ ...prev, withdrawingEntry: entryId }));

    try {
      const response = await axios.post(`/api/contests/withdraw/${entryId}`);
      
      if (response.data.success) {
        showToast('Successfully withdrew from contest', 'success');
        
        // Update balance if provided
        if (response.data.newBalance !== undefined && updateBalance) {
          updateBalance(response.data.newBalance);
        }
        
        // Find the entry to get room info
        const entry = data.userEntries.find(e => e.id === entryId);
        if (entry?.draftRoomId) {
          // Leave socket room
          socketService.emit('leave-room', { 
            roomId: entry.draftRoomId,
            userId: user.id
          });
          joinedRoomsRef.current.delete(entry.draftRoomId);
          pendingRoomJoinsRef.current.delete(entry.draftRoomId);
        }
        
        // Optimistic update
        setData(prev => ({
          ...prev,
          userEntries: prev.userEntries.filter(e => e.id !== entryId),
          contests: prev.contests.map(c => {
            const entry = prev.userEntries.find(e => e.id === entryId);
            if (entry && c.id === entry.contestId) {
              return { ...c, currentEntries: Math.max(0, (c.currentEntries || 0) - 1) };
            }
            return c;
          })
        }));
        
        // Refresh data in background
        setTimeout(() => fetchAllData(), 1000);
      }
    } catch (error) {
      console.error('Error withdrawing:', error);
      const errorMessage = error.response?.data?.error || 'Failed to withdraw';
      showToast(errorMessage, 'error');
      
      // Refresh data to ensure consistency
      fetchAllData();
    } finally {
      setActions(prev => ({ ...prev, withdrawingEntry: null }));
    }
  }, [user, data.userEntries, showToast, updateBalance, fetchAllData]);

  // Market Mover navigation
  const handleMarketMoverClick = useCallback((contest) => {
    navigate(`/market-mover/${contest.id}`);
  }, [navigate]);

  // Improved rejoin draft handler
  const handleRejoinDraft = useCallback((contest, userEntry) => {
    const contestData = {
      contestId: contest.id,
      contestType: contest.type,
      contestName: contest.name,
      entryId: userEntry.id,
      draftRoomId: userEntry.draftRoomId || contest.id,
      playerBoard: contest.playerBoard,
      entry: userEntry
    };
    
    sessionStorage.setItem('currentDraft', JSON.stringify(contestData));
    
    // Ensure we're in the socket room
    const roomId = userEntry.draftRoomId;
    if (roomId && !joinedRoomsRef.current.has(roomId) && !pendingRoomJoinsRef.current.has(roomId)) {
      console.log('Joining room for draft rejoin:', roomId);
      pendingRoomJoinsRef.current.add(roomId);
      
      socketService.emit('join-room', { 
        roomId: roomId,
        userId: user.id
      });
    }
    
    // Emit join-draft
    console.log('Emitting join-draft for rejoin:', {
      contestId: contest.id,
      entryId: userEntry.id
    });
    
    socketService.emit('join-draft', {
      contestId: contest.id,
      entryId: userEntry.id
    });
    
    navigate(`/draft/${userEntry.draftRoomId}`);
  }, [navigate, user]);

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    showToast('Refreshing contests...', 'info');
    await fetchAllData();
  }, [fetchAllData, showToast]);

  // Memoized filtered contests
  const filteredContests = useMemo(() => {
    return data.contests.filter(contest => {
      // Type filter
      if (filters.type !== CONTEST_TYPES.ALL && contest.type !== filters.type) {
        return false;
      }
      
      // Status filter
      const userEntry = data.userEntries.find(e => 
        e.contestId === contest.id && 
        ['pending', 'drafting', 'completed'].includes(e.status)
      );
      
      if (filters.status === FILTER_TYPES.ENTERED && !userEntry) {
        return false;
      }
      
      if (filters.status === FILTER_TYPES.OPEN) {
        return contest.status === 'open' && !userEntry;
      }
      
      return true;
    });
  }, [data.contests, data.userEntries, filters]);

  // Loading state
  if (data.loading) {
    return (
      <div className="lobby-container">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading contests...</p>
        </div>
      </div>
    );
  }

  // Socket status display
  const getSocketStatusDisplay = () => {
    if (socketStatus.authenticated) {
      return { text: '● Connected', className: 'connected' };
    } else if (socketStatus.connected) {
      return { text: '◐ Connecting...', className: 'connecting' };
    } else {
      return { text: '○ Disconnected', className: 'disconnected' };
    }
  };

  const socketStatusDisplay = getSocketStatusDisplay();

  return (
    <div className="lobby-container">
      <div className="lobby-header">
        <h1 className="lobby-title">Contest Lobby</h1>
        <p className="lobby-subtitle">Choose your battle and build your ultimate roster!</p>
        
        <div className="lobby-stats">
          <div className="stat-item">
            <span className="stat-label">Balance:</span>
            <span className="stat-value balance">${Number(user?.balance || 0).toFixed(2)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Tickets:</span>
            <span className="stat-value tickets">{user?.tickets || 0}</span>
          </div>
          <div className="stat-item">
            <span className={`connection-indicator ${socketStatusDisplay.className}`}>
              {socketStatusDisplay.text}
            </span>
          </div>
        </div>
      </div>

      <div className="lobby-controls">
        <div className="filter-section">
          <div className="filter-group">
            <label htmlFor="status-filter">Show:</label>
            <select 
              id="status-filter"
              value={filters.status} 
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
              className="filter-select"
            >
              <option value={FILTER_TYPES.ALL}>All Contests</option>
              <option value={FILTER_TYPES.OPEN}>Open Contests</option>
              <option value={FILTER_TYPES.ENTERED}>My Contests</option>
            </select>
          </div>
          
          <div className="filter-group">
            <label htmlFor="type-filter">Type:</label>
            <select 
              id="type-filter"
              value={filters.type} 
              onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
              className="filter-select"
            >
              <option value={CONTEST_TYPES.ALL}>All Types</option>
              <option value={CONTEST_TYPES.CASH}>Cash Games</option>
              <option value={CONTEST_TYPES.BASH}>Daily Bash</option>
              <option value={CONTEST_TYPES.MARKET}>Market Mover</option>
              <option value={CONTEST_TYPES.FIRESALE}>Trading Floor</option>
            </select>
          </div>
        </div>

        <button 
          className="btn-refresh" 
          onClick={handleRefresh}
          disabled={isFetchingRef.current}
        >
          <span className="refresh-icon">🔄</span> Refresh
        </button>
      </div>

      <div className="contests-section">
        {filteredContests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🏆</div>
            <h3>No contests found</h3>
            <p>
              {filters.status === FILTER_TYPES.ENTERED 
                ? 'You haven\'t entered any contests yet. Start by joining an open contest!' 
                : filters.status === FILTER_TYPES.OPEN
                ? 'All open contests have been entered or filled. Check back soon!'
                : 'No contests are available at the moment. Check back soon!'}
            </p>
            {filters.type !== CONTEST_TYPES.ALL || filters.status !== FILTER_TYPES.ALL ? (
              <button 
                className="btn btn-secondary" 
                onClick={() => setFilters({ type: CONTEST_TYPES.ALL, status: FILTER_TYPES.ALL })}
              >
                Clear Filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="contests-grid">
            {filteredContests.map(contest => {
              const userEntry = data.userEntries.find(e => 
                e.contestId === contest.id && 
                ['pending', 'drafting', 'completed'].includes(e.status)
              );
              
              return (
                <ContestCard
                  key={contest.id}
                  contest={contest}
                  userEntry={userEntry}
                  onEnter={handleEnterContest}
                  onWithdraw={handleWithdrawContest}
                  onMarketMover={handleMarketMoverClick}
                  onRejoinDraft={handleRejoinDraft}
                  isEntering={actions.enteringContest === contest.id}
                  isWithdrawing={actions.withdrawingEntry === userEntry?.id}
                  userBalance={user?.balance || 0}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="lobby-footer">
        <p className="last-update">
          Last updated: {new Date().toLocaleTimeString()}
        </p>
        <p className="auto-refresh-notice">
          Auto-refreshing every 30 seconds
        </p>
        {socketStatus.authenticated && socketStatus.userId && (
          <p className="socket-info">
            Socket ID: {socketStatus.userId.substring(0, 8)}...
          </p>
        )}
      </div>
    </div>
  );
};

export default LobbyScreen;