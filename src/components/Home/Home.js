// frontend/src/components/Home/Home.js
import React, { useState, useEffect } from 'react';
import './Home.css';
import VoteModal from '../MarketMover/VoteModal';
import OwnershipModal from '../MarketMover/OwnershipModal';

const Home = ({ user, onNavigate }) => {
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showOwnershipModal, setShowOwnershipModal] = useState(false);
  const [marketMoverData, setMarketMoverData] = useState({
    votingActive: false,
    currentLeaders: [],
    nextVoteTime: null,
    currentBidUpPlayer: null
  });
  const [achievements, setAchievements] = useState({
    total: 0,
    completed: 0,
    points: 0,
    recentUnlocks: []
  });

  useEffect(() => {
    if (user) {
      fetchMarketMoverStatus();
      fetchAchievementsSummary();
    }
  }, [user]);

  const fetchMarketMoverStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5000/api/market-mover/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setMarketMoverData({
          votingActive: data.votingActive,
          currentLeaders: data.leaderboard || [],
          nextVoteTime: data.nextVoteTime,
          currentBidUpPlayer: data.currentBidUpPlayer
        });
      }
    } catch (error) {
      console.error('Error fetching market mover status:', error);
    }
  };

  const fetchAchievementsSummary = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5000/api/achievements/progress', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        setAchievements({
          total: data.total || 0,
          completed: data.completed || 0,
          points: data.points || 0,
          recentUnlocks: data.recentUnlocks || []
        });
      }
    } catch (error) {
      console.error('Error fetching achievements:', error);
    }
  };

  const handleVote = async (player) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5000/api/market-mover/vote', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          playerName: player.name,
          playerId: player.id 
        })
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Vote submitted for ${player.name}!`);
        fetchMarketMoverStatus();
        // Update user tickets if needed
        if (data.newTickets !== undefined && user) {
          user.tickets = data.newTickets;
        }
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to submit vote');
      }
    } catch (error) {
      console.error('Vote error:', error);
      throw error;
    }
  };

  const handleOwnershipQuery = async (contestId, playerName) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('http://localhost:5000/api/market-mover/ownership', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ contestId, playerName })
      });

      if (response.ok) {
        const data = await response.json();
        // Update user tickets if needed
        if (data.newTickets !== undefined && user) {
          user.tickets = data.newTickets;
        }
        return data.ownership || 0;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to check ownership');
      }
    } catch (error) {
      console.error('Ownership query error:', error);
      throw error;
    }
  };

  return (
    <div className="home">
      {/* Achievements Badge */}
      {user && (
        <div className="achievements-badge" onClick={() => onNavigate('achievements')}>
          <div className="badge-icon">🏆</div>
          <div className="badge-info">
            <span className="badge-label">Achievements</span>
            <span className="badge-value">{achievements.completed}/{achievements.total}</span>
          </div>
          <div className="badge-points">{achievements.points} pts</div>
        </div>
      )}

      <div className="hero-section">
        <h1 className="hero-title">Fantasy Draft</h1>
        <p className="hero-subtitle">Draft. Compete. Win.</p>
        
        {!user ? (
          <div className="cta-buttons">
            <button className="btn btn-primary" onClick={() => onNavigate('login')}>
              Start Playing
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigate('login')}>
              Learn More
            </button>
          </div>
        ) : (
          <div className="cta-buttons">
            <button className="btn btn-primary" onClick={() => onNavigate('lobby')}>
              Enter Lobby
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigate('my-contests')}>
              My Contests
            </button>
          </div>
        )}
      </div>

      {/* Market Mover Section */}
      {user && (
        <div className="market-mover-section">
          <h2>Market Mover Hub</h2>
          
          {marketMoverData.votingActive && (
            <div className="voting-status">
              <div className="status-indicator active">
                <span className="pulse"></span>
                Voting is ACTIVE
              </div>
              {marketMoverData.nextVoteTime && (
                <p className="next-vote-time">
                  Next voting period: {new Date(marketMoverData.nextVoteTime).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {marketMoverData.currentBidUpPlayer && (
            <div className="current-bid-up">
              <h3>Current BID UP Player</h3>
              <div className="bid-up-player">
                <span className="player-name">{marketMoverData.currentBidUpPlayer.name}</span>
                <span className="boost-indicator">+35% appearance rate</span>
              </div>
            </div>
          )}

          <div className="market-mover-actions">
            <div className="action-card" onClick={() => setShowVoteModal(true)}>
              <div className="action-icon">🗳️</div>
              <h3>Vote for BID UP</h3>
              <p>Use 1 ticket to vote for the next boosted player</p>
              <span className="ticket-cost">Cost: 1 🎟️</span>
            </div>

            <div className="action-card" onClick={() => setShowOwnershipModal(true)}>
              <div className="action-icon">📊</div>
              <h3>Check Ownership</h3>
              <p>See what % of lineups contain a specific player</p>
              <span className="ticket-cost">Cost: 1 🎟️</span>
            </div>

            <div className="action-card" onClick={() => onNavigate('ticket-shop')}>
              <div className="action-icon">🎟️</div>
              <h3>Buy Tickets</h3>
              <p>Get tickets for Market Mover features</p>
              <span className="current-tickets">You have: {user.tickets || 0} 🎟️</span>
            </div>
          </div>

          {marketMoverData.currentLeaders.length > 0 && (
            <div className="vote-leaderboard">
              <h3>Current Vote Leaders</h3>
              <div className="leaders-list">
                {marketMoverData.currentLeaders.slice(0, 5).map((leader, index) => (
                  <div key={index} className="leader-item">
                    <span className="rank">#{index + 1}</span>
                    <span className="player-name">{leader.name}</span>
                    <span className="vote-count">{leader.votes} votes</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="features-section">
        <h2>Game Modes</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">💰</div>
            <h3>Cash Games</h3>
            <p>5-player winner-take-all contests with $5 entry fee</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">🎉</div>
            <h3>Daily Bash</h3>
            <p>Free entry tournament with guaranteed prizes</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">📈</div>
            <h3>Market Mover</h3>
            <p>Vote on players and compete for ownership percentage</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">🔥</div>
            <h3>Trading Floor Firesale</h3>
            <p>Fast-paced free contest with unique scoring</p>
          </div>
        </div>
      </div>

      <div className="how-it-works">
        <h2>How It Works</h2>
        <div className="steps">
          <div className="step">
            <div className="step-number">1</div>
            <h3>Choose a Contest</h3>
            <p>Pick from various game modes and entry fees</p>
          </div>
          <div className="step">
            <div className="step-number">2</div>
            <h3>Draft Your Team</h3>
            <p>Select 5 players within your $15 budget</p>
          </div>
          <div className="step">
            <div className="step-number">3</div>
            <h3>Compete & Win</h3>
            <p>Score points based on real player performance</p>
          </div>
        </div>
      </div>

      {/* Recent Achievements */}
      {user && achievements.recentUnlocks.length > 0 && (
        <div className="recent-achievements">
          <h3>Recent Achievements</h3>
          <div className="achievements-list">
            {achievements.recentUnlocks.map((achievement, index) => (
              <div key={index} className="achievement-item">
                <span className="achievement-icon">{achievement.icon || '🏅'}</span>
                <span className="achievement-name">{achievement.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {user && (
        <>
          <VoteModal
            isOpen={showVoteModal}
            onClose={() => setShowVoteModal(false)}
            onVote={handleVote}
            tickets={user.tickets || 0}
            currentLeaders={marketMoverData.currentLeaders}
          />
          <OwnershipModal
            isOpen={showOwnershipModal}
            onClose={() => setShowOwnershipModal(false)}
            onQuery={handleOwnershipQuery}
            tickets={user.tickets || 0}
          />
        </>
      )}
    </div>
  );
};

export default Home;