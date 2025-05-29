import React, { useState, useEffect } from 'react';
import './MarketMover.css';
import { PLAYER_POOLS } from '../../utils/gameLogic';

const VoteModal = ({ isOpen, onClose, onVote, tickets, currentLeaders }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [isVoting, setIsVoting] = useState(false);
  const [allPlayers, setAllPlayers] = useState([]);

  useEffect(() => {
    // Combine all players from player pools
    const players = [];
    
    Object.entries(PLAYER_POOLS).forEach(([position, priceGroups]) => {
      Object.entries(priceGroups).forEach(([price, playerList]) => {
        playerList.forEach(player => {
          players.push({
            ...player,
            position,
            price: parseInt(price),
            id: `${player.name}-${player.team}`,
            displayName: `${player.name} ${player.team}`
          });
        });
      });
    });
    
    // Sort by name
    players.sort((a, b) => a.name.localeCompare(b.name));
    setAllPlayers(players);
  }, []);

  const filteredPlayers = allPlayers.filter(player =>
    player.displayName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleVote = async () => {
    if (!selectedPlayer || tickets < 1) return;
    
    setIsVoting(true);
    try {
      await onVote(selectedPlayer);
      onClose();
    } catch (error) {
      alert(error.message);
    } finally {
      setIsVoting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content vote-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Vote for Next BID UP Player</h2>
          <button className="close-button" onClick={onClose}>&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <p>Cost: <span className="ticket-cost">1 ticket</span> (You have {tickets})</p>
            <p className="vote-description">
              The player with the most votes will get a 35% appearance boost in all Market Mover contests!
            </p>
          </div>
          
          {currentLeaders.length > 0 && (
            <div className="current-leaders-preview">
              <h4>Current Leaders:</h4>
              <div className="leaders-preview-list">
                {currentLeaders.slice(0, 3).map((leader, index) => (
                  <span key={index} className="leader-preview">
                    {index + 1}. {leader.name} ({leader.votes})
                  </span>
                ))}
              </div>
            </div>
          )}
          
          <div className="search-section">
            <input
              type="text"
              placeholder="Search players by name or team..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="player-search"
              autoFocus
            />
          </div>
          
          <div className="players-list">
            {filteredPlayers.length === 0 ? (
              <p className="no-results">No players found matching "{searchTerm}"</p>
            ) : (
              filteredPlayers.slice(0, 20).map(player => (
                <div
                  key={player.id}
                  className={`player-option ${selectedPlayer?.id === player.id ? 'selected' : ''}`}
                  onClick={() => setSelectedPlayer(player)}
                >
                  <div className="player-info">
                    <span className="player-name">{player.displayName}</span>
                    <span className={`player-position ${player.position}`}>{player.position}</span>
                  </div>
                  <span className="player-price">${player.price}</span>
                </div>
              ))
            )}
          </div>
          
          {filteredPlayers.length > 20 && (
            <p className="more-results">
              Showing 20 of {filteredPlayers.length} results. Type more to narrow search.
            </p>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button 
            className="vote-btn"
            onClick={handleVote}
            disabled={!selectedPlayer || tickets < 1 || isVoting}
          >
            {isVoting ? 'Voting...' : `Vote for ${selectedPlayer?.name || 'Select Player'}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoteModal;