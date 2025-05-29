import React, { useState, useEffect } from 'react';
import './MarketMover.css';
import { PLAYER_POOLS } from '../../utils/gameLogic';

const OwnershipModal = ({ isOpen, onClose, onQuery, tickets }) => {
  const [contestId, setContestId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [result, setResult] = useState(null);
  const [activeContests, setActiveContests] = useState([]);
  const [allPlayers, setAllPlayers] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchActiveContests();
      loadAllPlayers();
    }
  }, [isOpen]);

  const loadAllPlayers = () => {
    const players = [];
    
    Object.entries(PLAYER_POOLS).forEach(([position, priceGroups]) => {
      Object.entries(priceGroups).forEach(([price, playerList]) => {
        playerList.forEach(player => {
          players.push({
            ...player,
            position,
            price: parseInt(price),
            fullName: player.name
          });
        });
      });
    });
    
    // Remove duplicates and sort
    const uniquePlayers = Array.from(new Map(players.map(p => [p.name, p])).values());
    uniquePlayers.sort((a, b) => a.name.localeCompare(b.name));
    setAllPlayers(uniquePlayers);
  };

  const fetchActiveContests = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5000/api/market-mover/active-contests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setActiveContests(data.contests || []);
        if (data.contests.length > 0) {
          setContestId(data.contests[0].id);
        }
      }
    } catch (error) {
      console.error('Error fetching active contests:', error);
      // For now, show all Market Mover contests
      const allContestsResponse = await fetch('http://localhost:5000/api/contests', {
        headers: { 'Authorization': localStorage.getItem('token') }
      });
      if (allContestsResponse.ok) {
        const allContests = await allContestsResponse.json();
        const mmContests = allContests.filter(c => c.type === 'market');
        setActiveContests(mmContests);
        if (mmContests.length > 0) {
          setContestId(mmContests[0].id);
        }
      }
    }
  };

  const handlePlayerNameChange = (e) => {
    const value = e.target.value;
    setPlayerName(value);
    
    if (value.length > 0) {
      const filtered = allPlayers.filter(player => 
        player.name.toLowerCase().includes(value.toLowerCase())
      );
      setSuggestions(filtered.slice(0, 8)); // Show max 8 suggestions
      setShowSuggestions(true);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (player) => {
    setPlayerName(player.name);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const handleQuery = async () => {
    if (!contestId || !playerName.trim() || tickets < 1) return;
    
    setIsQuerying(true);
    try {
      const ownership = await onQuery(contestId, playerName.trim());
      setResult({
        playerName: playerName.trim(),
        ownership: ownership.toFixed(2),
        contestName: activeContests.find(c => c.id === contestId)?.name || 'Market Mover'
      });
    } catch (error) {
      alert(error.message);
    } finally {
      setIsQuerying(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    setPlayerName('');
    setSuggestions([]);
    setShowSuggestions(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content ownership-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Check Player Ownership</h2>
          <button className="close-button" onClick={handleClose}>&times;</button>
        </div>
        
        <div className="modal-body">
          {!result ? (
            <>
              <div className="ownership-info">
                <p>Cost: <span className="ticket-cost">1 ticket</span> (You have {tickets})</p>
                <p className="ownership-description">
                  Find out what percentage of Market Mover lineups contain a specific player.
                </p>
              </div>
              
              <div className="query-form">
                <div className="form-group">
                  <label>Select Contest:</label>
                  <select 
                    value={contestId} 
                    onChange={(e) => setContestId(e.target.value)}
                    className="contest-select"
                  >
                    {activeContests.length === 0 ? (
                      <option value="">No Market Mover contests available</option>
                    ) : (
                      activeContests.map(contest => (
                        <option key={contest.id} value={contest.id}>
                          {contest.name} ({contest.currentEntries} entries)
                        </option>
                      ))
                    )}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Player Name:</label>
                  <div className="autocomplete-wrapper">
                    <input
                      type="text"
                      placeholder="Start typing player name..."
                      value={playerName}
                      onChange={handlePlayerNameChange}
                      onFocus={() => playerName.length > 0 && setShowSuggestions(true)}
                      className="player-input"
                      autoFocus
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="suggestions-dropdown">
                        {suggestions.map((player, index) => (
                          <div 
                            key={index}
                            className="suggestion-item"
                            onClick={() => selectSuggestion(player)}
                          >
                            <span className="suggestion-name">{player.name}</span>
                            <span className="suggestion-details">
                              {player.team} - {player.position}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <small className="input-hint">
                    Select from suggestions or enter exact name
                  </small>
                </div>
              </div>
            </>
          ) : (
            <div className="ownership-result">
              <div className="result-icon">📊</div>
              <h3>{result.playerName}</h3>
              <div className="ownership-percentage">
                {result.ownership}%
              </div>
              <p className="result-context">
                of lineups in {result.contestName}
              </p>
              <button 
                className="check-another-btn"
                onClick={() => setResult(null)}
              >
                Check Another Player
              </button>
            </div>
          )}
        </div>
        
        {!result && (
          <div className="modal-footer">
            <button className="cancel-btn" onClick={handleClose}>Cancel</button>
            <button 
              className="query-btn"
              onClick={handleQuery}
              disabled={!contestId || !playerName.trim() || tickets < 1 || isQuerying || activeContests.length === 0}
            >
              {isQuerying ? 'Checking...' : 'Check Ownership'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OwnershipModal;