// frontend/src/components/Draft/DraftScreen.js
import React, { useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import {
  initializeDraft,
  joinDraftRoom,
  leaveDraftRoom,
  makePick,
  skipTurn,
  setSelectedPlayer,
  setAutoPickEnabled,
  setShowAutoPickSuggestion,
  setCurrentViewTeam,
  resetDraft
} from '../../store/slices/draftSlice';
import { selectAuthUser } from '../../store/slices/authSlice';
import './DraftScreen.css';

const DraftScreen = ({ showToast }) => {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const mountedRef = useRef(true);
  const autoPickTimeoutRef = useRef(null);

  // Redux selectors
  const user = useSelector(selectAuthUser);
  const {
    status,
    playerBoard,
    currentTurn,
    draftOrder,
    picks,
    timeRemaining,
    currentDrafter,
    currentDrafterPosition,
    userDraftPosition,
    users,
    countdownTime,
    contestData,
    entryId,
    contestType,
    myRoster,
    budget,
    bonus,
    teams,
    selectedPlayer,
    isMyTurn,
    showResults,
    currentViewTeam,
    autoPickEnabled,
    showAutoPickSuggestion,
    autoPickSuggestion,
    error
  } = useSelector(state => state.draft);

  const socketConnected = useSelector(state => state.socket.connected);
  const socketAuthenticated = useSelector(state => state.socket.authenticated);

  // Initialize draft on mount
  useEffect(() => {
    console.log('=== DRAFT SCREEN MOUNTED ===');
    console.log('Room ID from URL:', roomId);
    console.log('User:', user);
    console.log('Socket Connected:', socketConnected);
    console.log('Socket Authenticated:', socketAuthenticated);
    
    if (!user || !roomId) {
      console.error('Missing user or roomId');
      showToast('Missing required data', 'error');
      navigate('/lobby');
      return;
    }

    // Initialize draft (replaces getDraftData and initializeSocket)
    dispatch(initializeDraft({ roomId, userId: user.id }))
      .unwrap()
      .then(() => {
        console.log('Draft initialized successfully');
      })
      .catch((error) => {
        console.error('Failed to initialize draft:', error);
        showToast('Failed to initialize draft', 'error');
        navigate('/lobby');
      });

    return () => {
      console.log('=== DRAFT SCREEN UNMOUNTING ===');
      mountedRef.current = false;
      
      if (autoPickTimeoutRef.current) {
        clearTimeout(autoPickTimeoutRef.current);
      }
      
      // Leave draft room
      dispatch(leaveDraftRoom({ roomId }));
      
      // Reset draft state
      dispatch(resetDraft());
    };
  }, [roomId, user, navigate, showToast, dispatch]);

  // Handle socket connection and join room when ready
  useEffect(() => {
    if (socketAuthenticated && status === 'initialized' && contestData) {
      console.log('Socket authenticated, joining draft room');
      dispatch(joinDraftRoom({
        contestId: contestData.contestId,
        entryId: entryId,
        roomId: roomId
      }));
    }
  }, [socketAuthenticated, status, contestData, entryId, roomId, dispatch]);

  // Handle auto-pick timer
  useEffect(() => {
    if (isMyTurn && status === 'active' && timeRemaining <= 0 && autoPickEnabled) {
      handleAutoPick();
    }
  }, [isMyTurn, status, timeRemaining, autoPickEnabled]);

  // Show toast messages for errors
  useEffect(() => {
    if (error && showToast) {
      showToast(error, 'error');
    }
  }, [error, showToast]);

  // Handle player selection
  const selectPlayer = useCallback((row, col) => {
    if (!isMyTurn) {
      showToast("It's not your turn!", 'error');
      return;
    }
    
    const player = playerBoard[row][col];
    if (player.drafted) {
      showToast('This player has already been drafted!', 'error');
      return;
    }
    
    const myTeam = teams.find(t => t.userId === user?.id);
    if (!myTeam) return;
    
    const availableSlots = getAvailableSlots(myTeam, player);
    if (availableSlots.length === 0) {
      showToast(`No available slots for ${player.name}!`, 'error');
      return;
    }
    
    const totalBudget = Math.max(0, myTeam.budget) + myTeam.bonus;
    if (player.price > totalBudget) {
      showToast(`Not enough budget! You have $${totalBudget}`, 'error');
      return;
    }
    
    const rosterSlot = availableSlots[0];
    
    console.log(`Making pick: ${player.name} to ${rosterSlot} slot`);
    
    dispatch(makePick({
      roomId,
      row,
      col,
      player,
      rosterSlot
    }));
  }, [isMyTurn, playerBoard, teams, user, roomId, dispatch, showToast]);

  // Get available slots for a player
  const getAvailableSlots = (team, player) => {
    const playerPos = player.originalPosition || player.position;
    const availableSlots = [];
    const roster = team.roster || {};

    // Check if the specific position slot is open
    if (!roster[playerPos]) {
      availableSlots.push(playerPos);
    }

    // Check if FLEX slot is available (only for RB, WR, TE)
    if (!roster.FLEX && ['RB', 'WR', 'TE'].includes(playerPos)) {
      availableSlots.push('FLEX');
    }

    return availableSlots;
  };

  // Handle auto-pick
  const handleAutoPick = useCallback(() => {
    if (!autoPickEnabled || !autoPickSuggestion) return;
    
    const bestPick = autoPickSuggestion;
    if (bestPick) {
      console.log('Auto-picking:', bestPick.player.name);
      selectPlayer(bestPick.row, bestPick.col);
    } else {
      console.log('No valid picks available, skipping turn');
      dispatch(skipTurn({ roomId, reason: 'no_valid_picks' }));
    }
  }, [autoPickEnabled, autoPickSuggestion, selectPlayer, roomId, dispatch]);

  // Handle skip turn
  const handleSkipTurn = useCallback(() => {
    if (!isMyTurn) return;
    
    dispatch(skipTurn({ roomId, reason: 'manual_skip' }));
  }, [isMyTurn, roomId, dispatch]);

  // Handle return to lobby
  const handleReturnToLobby = useCallback(() => {
    navigate('/lobby');
  }, [navigate]);

  // Handle team navigation
  const handlePrevTeam = useCallback(() => {
    dispatch(setCurrentViewTeam(
      currentViewTeam > 0 ? currentViewTeam - 1 : teams.length - 1
    ));
  }, [currentViewTeam, teams.length, dispatch]);

  const handleNextTeam = useCallback(() => {
    dispatch(setCurrentViewTeam(
      currentViewTeam < teams.length - 1 ? currentViewTeam + 1 : 0
    ));
  }, [currentViewTeam, teams.length, dispatch]);

  // Handle auto-pick toggle
  const handleAutoPickToggle = useCallback((e) => {
    dispatch(setAutoPickEnabled(e.target.checked));
  }, [dispatch]);

  // Handle suggestion toggle
  const handleSuggestionToggle = useCallback((e) => {
    dispatch(setShowAutoPickSuggestion(e.target.checked));
  }, [dispatch]);

  // Render loading state
  if (status === 'loading' || status === 'initialized') {
    return (
      <div className="draft-container">
        <div className="loading-screen">
          <div className="loading-spinner"></div>
          <p>Loading draft...</p>
        </div>
      </div>
    );
  }

  // Render waiting state
  if (status === 'waiting') {
    return (
      <div className="draft-container">
        <div className="waiting-screen">
          <h1>Waiting for Draft to Start</h1>
          <p>Connected Players: {users.filter(u => u.connected).length} / {users.length}</p>
          
          <div className="connected-users">
            {users.map((user, index) => (
              <div key={user.userId} className="user-status">
                <span>{user.username}</span>
                <span className={user.connected ? 'connected' : 'disconnected'}>
                  {user.connected ? '✓' : '✗'}
                </span>
              </div>
            ))}
          </div>
          
          <button onClick={handleReturnToLobby} className="back-button">
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // Render countdown state
  if (status === 'countdown') {
    return (
      <div className="draft-container">
        <div className="countdown-screen">
          <h1>Draft Starting Soon!</h1>
          <div className="countdown-timer">
            <div className="countdown-number">{countdownTime}</div>
          </div>
          <p>Get ready to draft!</p>
          
          <div className="draft-order-preview">
            <h3>Draft Order:</h3>
            <div className="users-list">
              {teams.map((team, index) => (
                <div key={team.userId} className={`user-item ${team.userId === user?.id ? 'current-user' : ''}`}>
                  <span className="position">{index + 1}.</span>
                  <span className={`username team-${team.color?.toLowerCase()}`}>
                    {team.name} {team.userId === user?.id && '(You)'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Render results state
  if (showResults || status === 'completed') {
    return (
      <div className="draft-container">
        <div className="results-screen">
          <h1>Draft Complete!</h1>
          
          <div className="team-viewer">
            <div className="team-navigation">
              <button 
                onClick={handlePrevTeam}
                disabled={teams.length <= 1}
              >
                ←
              </button>
              <h2 className={`team-name team-${teams[currentViewTeam]?.color?.toLowerCase()}`}>
                {teams[currentViewTeam]?.name}
                {teams[currentViewTeam]?.userId === user?.id && ' (Your Team)'}
              </h2>
              <button 
                onClick={handleNextTeam}
                disabled={teams.length <= 1}
              >
                →
              </button>
            </div>
            
            <div className="roster-display">
              {['QB', 'RB', 'WR', 'TE', 'FLEX'].map(slot => {
                const player = teams[currentViewTeam]?.roster[slot];
                return (
                  <div key={slot} className="roster-slot">
                    <span className="slot-label">{slot}:</span>
                    {player ? (
                      <div className="player-info">
                        <span className="player-name">{player.name}</span>
                        <span className="player-details">
                          {player.team} - ${player.price}
                        </span>
                      </div>
                    ) : (
                      <span className="empty-slot">Empty</span>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className="team-summary">
              <p>Total Spent: ${15 - (teams[currentViewTeam]?.budget || 0)}</p>
              <p>Budget Remaining: ${teams[currentViewTeam]?.budget || 0}</p>
              {(teams[currentViewTeam]?.bonus || 0) > 0 && (
                <p>Bonus Earned: ${teams[currentViewTeam].bonus}</p>
              )}
            </div>
          </div>
          
          <button onClick={handleReturnToLobby} className="return-button">
            Return to Lobby
          </button>
        </div>
      </div>
    );
  }

  // Render active draft
  return (
    <div className="draft-container">
      <div className="draft-header">
        <div className="timer-section">
          <div className={`timer ${isMyTurn ? 'my-turn' : ''}`}>
            Time: <span className="time-value">{timeRemaining}s</span>
          </div>
          {isMyTurn && <div className="turn-indicator">Your Turn!</div>}
        </div>
        
        <div className="draft-info">
          <span>Round {Math.floor(currentTurn / teams.length) + 1} of 5</span>
          <span>Pick {(currentTurn % (teams.length * 5)) + 1} of {teams.length * 5}</span>
          <span>Budget: ${budget + bonus}</span>
        </div>
        
        <div className="controls">
          <label>
            <input 
              type="checkbox" 
              checked={autoPickEnabled}
              onChange={handleAutoPickToggle}
            />
            Auto-pick
          </label>
          <label>
            <input 
              type="checkbox" 
              checked={showAutoPickSuggestion}
              onChange={handleSuggestionToggle}
            />
            Show suggestions
          </label>
        </div>
      </div>

      <div className="player-board">
        {playerBoard?.map((row, rowIndex) => (
          <div key={rowIndex} className="price-row">
            <div className="price-label">${5 - rowIndex}</div>
            {row.map((player, colIndex) => {
              const isAutoSuggestion = autoPickSuggestion && 
                autoPickSuggestion.row === rowIndex && 
                autoPickSuggestion.col === colIndex;
              
              return (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={`player-card 
                    ${player.drafted ? 'drafted' : ''} 
                    ${player.drafted && player.draftedBy !== undefined ? 
                      `drafted-by-${teams[player.draftedBy]?.color?.toLowerCase()}` : ''} 
                    ${isAutoSuggestion ? 'auto-suggestion' : ''}
                    ${isMyTurn && !player.drafted ? 'clickable' : ''}
                  `}
                  onClick={() => isMyTurn && !player.drafted && selectPlayer(rowIndex, colIndex)}
                >
                  <div className={`position-badge ${player.position}`}>
                    {player.position}
                  </div>
                  <div className="player-name">{player.name}</div>
                  <div className="player-team">{player.team} - ${player.price}</div>
                  {isAutoSuggestion && (
                    <div className="suggestion-indicator">⭐ Best Pick</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="teams-section">
        {teams.map((team, index) => {
          const isCurrentTurn = team.draftPosition === currentDrafterPosition;
          
          return (
            <div 
              key={team.userId} 
              className={`team-card 
                ${isCurrentTurn ? 'current-turn' : ''} 
                ${team.userId === user?.id ? 'my-team' : ''}
                team-${team.color?.toLowerCase()}
              `}
            >
              <div className="team-header">
                <h3>{team.name}</h3>
                <span className="budget">${team.budget}</span>
                {team.bonus > 0 && <span className="bonus">+${team.bonus}</span>}
              </div>
              
              <div className="roster">
                {['QB', 'RB', 'WR', 'TE', 'FLEX'].map(slot => (
                  <div key={slot} className="roster-slot">
                    <span className="slot-label">{slot}:</span>
                    {team.roster[slot] ? (
                      <span className="player">{team.roster[slot].name}</span>
                    ) : (
                      <span className="empty">-</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DraftScreen;