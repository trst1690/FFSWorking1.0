// frontend/src/store/slices/draftSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import socketService from '../../services/socket';

// Utility function to generate a basic player board
const generateBasicPlayerBoard = (type = 'cash') => {
  const positions = ['QB', 'RB', 'WR', 'TE'];
  const teams = ['KC', 'BUF', 'CIN', 'PHI', 'SF', 'DAL', 'MIA', 'BAL'];
  const names = {
    QB: ['Mahomes', 'Allen', 'Burrow', 'Hurts'],
    RB: ['McCaffrey', 'Ekeler', 'Barkley', 'Taylor'],
    WR: ['Hill', 'Jefferson', 'Chase', 'Diggs'],
    TE: ['Kelce', 'Andrews', 'Hockenson', 'Kittle']
  };
  
  const board = [];
  
  for (let price = 5; price >= 1; price--) {
    const row = [];
    for (let i = 0; i < 4; i++) {
      const position = positions[i];
      const playerIndex = 5 - price;
      row.push({
        name: names[position][playerIndex % names[position].length],
        position: position,
        originalPosition: position,
        team: teams[Math.floor(Math.random() * teams.length)],
        price: price,
        drafted: false,
        id: `${position}-${price}-${i}`
      });
    }
    board.push(row);
  }
  
  return board;
};

// Async thunks
export const initializeDraft = createAsyncThunk(
  'draft/initialize',
  async ({ roomId, userId }, { getState, rejectWithValue }) => {
    try {
      // Get any stored draft data (from navigation state, not sessionStorage)
      const state = getState();
      const navigationState = window.history.state?.usr;
      
      const draftData = {
        roomId,
        userId,
        ...navigationState?.draftData
      };

      // Ensure socket is connected
      const token = localStorage.getItem('token');
      if (!socketService.isConnected()) {
        await socketService.connect(token);
      }

      return draftData;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const joinDraftRoom = createAsyncThunk(
  'draft/joinRoom',
  async ({ contestId, entryId, roomId }, { rejectWithValue }) => {
    try {
      socketService.emit('join-draft', {
        contestId,
        entryId,
        roomId
      });
      
      return { contestId, entryId, roomId };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const leaveDraftRoom = createAsyncThunk(
  'draft/leaveRoom',
  async ({ roomId }, { rejectWithValue }) => {
    try {
      socketService.emit('leave-draft', { roomId });
      return roomId;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const makePick = createAsyncThunk(
  'draft/makePick',
  async ({ roomId, row, col, player, rosterSlot }, { rejectWithValue }) => {
    try {
      socketService.emit('make-pick', {
        roomId,
        row,
        col,
        player,
        rosterSlot
      });
      
      return { row, col, player, rosterSlot };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const skipTurn = createAsyncThunk(
  'draft/skipTurn',
  async ({ roomId, reason }, { rejectWithValue }) => {
    try {
      socketService.emit('skip-turn', {
        roomId,
        reason
      });
      
      return { reason };
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const saveDraftResults = createAsyncThunk(
  'draft/saveResults',
  async ({ entryId, roster, totalSpent }, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        '/api/drafts/complete',
        {
          entryId,
          roster,
          totalSpent
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

// Helper functions
const calculateKingpinBonus = (team, newPlayer) => {
  let bonusAdded = 0;
  const roster = team.roster || {};
  const players = Object.values(roster).filter(p => p);
  
  // Check for duplicate player bonus
  const duplicates = players.filter(p => 
    p.name === newPlayer.name && p.team === newPlayer.team
  );
  if (duplicates.length === 1) {
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
};

const calculateBestPick = (state, userId) => {
  const myTeam = state.teams.find(t => t.userId === userId);
  if (!myTeam || !state.playerBoard) return null;

  let bestPick = null;
  let bestScore = -1;
  const totalBudget = Math.max(0, myTeam.budget) + myTeam.bonus;

  // Get needed positions
  const neededPositions = [];
  if (!myTeam.roster.QB) neededPositions.push('QB');
  if (!myTeam.roster.RB) neededPositions.push('RB');
  if (!myTeam.roster.WR) neededPositions.push('WR');
  if (!myTeam.roster.TE) neededPositions.push('TE');

  state.playerBoard.forEach((row, rowIndex) => {
    row.forEach((player, colIndex) => {
      if (player.drafted || player.price > totalBudget) return;

      const availableSlots = getAvailableSlotsForPlayer(myTeam, player);
      if (availableSlots.length === 0) return;

      // Calculate score
      let score = player.price * 10; // Base score

      // Bonus for filling needed positions
      const playerPos = player.originalPosition || player.position;
      if (neededPositions.includes(playerPos)) {
        score += 50;
      }

      // Bonus for completing roster
      const filledSlots = Object.values(myTeam.roster).filter(p => p).length;
      if (filledSlots < 4) {
        score += 30;
      }

      // Penalty if it leaves too little budget
      const slotsRemaining = 5 - filledSlots - 1;
      const budgetAfter = totalBudget - player.price;
      if (slotsRemaining > 0 && budgetAfter < slotsRemaining) {
        score -= 50;
      }

      // Kingpin bonus consideration
      if (state.contestType === 'kingpin' || state.contestType === 'firesale') {
        const potentialBonus = calculateKingpinBonus(myTeam, player);
        score += potentialBonus * 20;
      }

      if (score > bestScore) {
        bestScore = score;
        bestPick = {
          row: rowIndex,
          col: colIndex,
          player,
          slot: availableSlots[0],
          score
        };
      }
    });
  });

  return bestPick;
};

const getAvailableSlotsForPlayer = (team, player) => {
  const playerPos = player.originalPosition || player.position;
  const availableSlots = [];
  const roster = team.roster || {};

  if (!roster[playerPos]) {
    availableSlots.push(playerPos);
  }

  if (!roster.FLEX && ['RB', 'WR', 'TE'].includes(playerPos)) {
    availableSlots.push('FLEX');
  }

  return availableSlots;
};

// Initial state
const initialState = {
  // Draft room info
  roomId: null,
  contestId: null,
  entryId: null,
  contestType: 'cash',
  contestData: null,
  
  // Draft state
  status: 'idle', // idle, initialized, loading, waiting, countdown, active, completed
  playerBoard: null,
  currentTurn: 0,
  draftOrder: [],
  picks: [],
  timeRemaining: 30,
  currentDrafter: null,
  currentDrafterPosition: null,
  userDraftPosition: null,
  countdownTime: null,
  
  // Users and teams
  users: [],
  teams: [],
  currentViewTeam: 0,
  
  // My draft info
  myRoster: {
    QB: null,
    RB: null,
    WR: null,
    TE: null,
    FLEX: null
  },
  budget: 15,
  bonus: 0,
  isMyTurn: false,
  
  // UI state
  selectedPlayer: null,
  autoPickEnabled: true,
  showAutoPickSuggestion: true,
  autoPickSuggestion: null,
  showResults: false,
  
  // Loading and error states
  loading: false,
  error: null
};

const draftSlice = createSlice({
  name: 'draft',
  initialState,
  reducers: {
    // Draft state updates from socket events
    updateDraftState: (state, action) => {
      const update = action.payload;
      
      // Update basic draft state
      if (update.status !== undefined) state.status = update.status;
      if (update.currentTurn !== undefined) state.currentTurn = update.currentTurn;
      if (update.draftOrder !== undefined) state.draftOrder = update.draftOrder;
      if (update.timeRemaining !== undefined) state.timeRemaining = update.timeRemaining;
      if (update.currentDrafter !== undefined) state.currentDrafter = update.currentDrafter;
      if (update.currentDrafterPosition !== undefined) state.currentDrafterPosition = update.currentDrafterPosition;
      if (update.userDraftPosition !== undefined) state.userDraftPosition = update.userDraftPosition;
      if (update.users !== undefined) state.users = update.users;
      if (update.playerBoard !== undefined) state.playerBoard = update.playerBoard;
      if (update.picks !== undefined) state.picks = update.picks;
      if (update.countdownTime !== undefined) state.countdownTime = update.countdownTime;
      
      // Initialize teams from users
      if (update.users && update.users.length > 0) {
        const teamColors = ['Green', 'Red', 'Blue', 'Yellow', 'Purple'];
        state.teams = update.users.map((user, index) => {
          const position = user.position ?? user.draftPosition ?? index;
          return {
            name: user.username,
            color: user.teamColor || teamColors[position],
            userId: user.userId,
            draftPosition: position,
            isHuman: !user.isBot,
            roster: user.roster || {
              QB: null,
              RB: null,
              WR: null,
              TE: null,
              FLEX: null
            },
            players: [],
            budget: user.budget ?? 15,
            bonus: user.bonus || 0
          };
        });
      }
      
      // Update turn status
      if (state.userDraftPosition !== null && state.currentDrafterPosition !== null) {
        state.isMyTurn = state.userDraftPosition === state.currentDrafterPosition;
      }
      
      // Calculate auto-pick suggestion if it's my turn
      if (state.isMyTurn && state.status === 'active' && state.showAutoPickSuggestion) {
        const userId = state.teams.find(t => t.draftPosition === state.userDraftPosition)?.userId;
        if (userId) {
          state.autoPickSuggestion = calculateBestPick(state, userId);
        }
      }
    },
    
    updateTimer: (state, action) => {
      state.timeRemaining = action.payload;
    },
    
    addPick: (state, action) => {
      const { pick, currentTurn, nextDrafter } = action.payload;
      
      // Add pick to list
      state.picks.push(pick);
      
      // Update board
      if (state.playerBoard?.[pick.row]?.[pick.col]) {
        state.playerBoard[pick.row][pick.col].drafted = true;
        state.playerBoard[pick.row][pick.col].draftedBy = pick.draftedBy ?? pick.draftPosition;
      }
      
      // Update team roster
      const teamIndex = state.teams.findIndex(t => t.userId === pick.userId);
      if (teamIndex !== -1) {
        const team = state.teams[teamIndex];
        team.roster[pick.rosterSlot] = pick.player;
        team.players.push({ ...pick.player, rosterSlot: pick.rosterSlot });
        team.budget = Math.max(0, team.budget - pick.player.price);
        
        // Update my roster if it's my pick
        const myTeam = state.teams.find(t => t.draftPosition === state.userDraftPosition);
        if (myTeam && myTeam.userId === pick.userId) {
          state.myRoster = { ...team.roster };
          state.budget = team.budget;
        }
        
        // Calculate kingpin bonus if applicable
        if (state.contestType === 'kingpin' || state.contestType === 'firesale') {
          const bonusEarned = calculateKingpinBonus(team, pick.player);
          team.bonus += bonusEarned;
          
          if (myTeam && myTeam.userId === pick.userId) {
            state.bonus += bonusEarned;
          }
        }
      }
      
      // Update turn
      if (currentTurn !== undefined) state.currentTurn = currentTurn;
      if (nextDrafter !== undefined) state.currentDrafterPosition = nextDrafter;
      
      // Update turn status
      state.isMyTurn = state.userDraftPosition === state.currentDrafterPosition;
      
      // Recalculate auto-pick suggestion
      if (state.isMyTurn && state.showAutoPickSuggestion) {
        const userId = state.teams.find(t => t.draftPosition === state.userDraftPosition)?.userId;
        if (userId) {
          state.autoPickSuggestion = calculateBestPick(state, userId);
        }
      }
    },
    
    setMyTurn: (state, action) => {
      state.isMyTurn = action.payload;
    },
    
    setSelectedPlayer: (state, action) => {
      state.selectedPlayer = action.payload;
    },
    
    setAutoPickEnabled: (state, action) => {
      state.autoPickEnabled = action.payload;
    },
    
    setShowAutoPickSuggestion: (state, action) => {
      state.showAutoPickSuggestion = action.payload;
    },
    
    setCurrentViewTeam: (state, action) => {
      state.currentViewTeam = action.payload;
    },
    
    setShowResults: (state, action) => {
      state.showResults = action.payload;
    },
    
    resetDraft: () => initialState
  },
  
  extraReducers: (builder) => {
    // Initialize draft
    builder
      .addCase(initializeDraft.pending, (state) => {
        state.loading = true;
        state.error = null;
        state.status = 'loading';
      })
      .addCase(initializeDraft.fulfilled, (state, action) => {
        state.loading = false;
        state.status = 'initialized';
        
        const data = action.payload;
        state.roomId = data.roomId;
        state.contestId = data.contestId;
        state.entryId = data.entryId;
        state.contestType = data.contestType || 'cash';
        state.contestData = data;
        
        // Set player board if available
        if (data.playerBoard) {
          state.playerBoard = data.playerBoard;
        } else {
          state.playerBoard = generateBasicPlayerBoard(data.contestType);
        }
      })
      .addCase(initializeDraft.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
        state.status = 'error';
      })
      
    // Join draft room
    builder
      .addCase(joinDraftRoom.fulfilled, (state, action) => {
        state.status = 'waiting';
      })
      .addCase(joinDraftRoom.rejected, (state, action) => {
        state.error = action.payload;
      })
      
    // Make pick
    builder
      .addCase(makePick.pending, (state) => {
        state.loading = true;
      })
      .addCase(makePick.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(makePick.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      
    // Save results
    builder
      .addCase(saveDraftResults.fulfilled, (state) => {
        console.log('Draft results saved successfully');
      })
      .addCase(saveDraftResults.rejected, (state, action) => {
        state.error = action.payload;
      });
  }
});

export const {
  updateDraftState,
  updateTimer,
  addPick,
  setMyTurn,
  setSelectedPlayer,
  setAutoPickEnabled,
  setShowAutoPickSuggestion,
  setCurrentViewTeam,
  setShowResults,
  resetDraft
} = draftSlice.actions;

export default draftSlice.reducer;