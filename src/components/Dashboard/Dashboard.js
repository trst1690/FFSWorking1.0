// frontend/src/components/Dashboard/Dashboard.js
import React from 'react';
import { Link } from 'react-router-dom';

const Dashboard = ({ user, showToast }) => {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Dashboard</h1>
      <p>Welcome back, {user?.username || 'Player'}!</p>
      
      <div style={{ 
        display: 'grid', 
        gap: '1rem', 
        marginTop: '2rem',
        maxWidth: '600px'
      }}>
        <div style={{ 
          padding: '1rem', 
          border: '1px solid #ddd', 
          borderRadius: '8px' 
        }}>
          <h3>Your Stats</h3>
          <p>Balance: ${user?.balance || 0}</p>
          <p>Tickets: {user?.tickets || 0}</p>
          <p>Total Contests: {user?.total_contests_entered || 0}</p>
          <p>Wins: {user?.total_contests_won || 0}</p>
        </div>
        
        <div style={{ 
          padding: '1rem', 
          border: '1px solid #ddd', 
          borderRadius: '8px' 
        }}>
          <h3>Quick Actions</h3>
          <Link to="/lobby">
            <button style={{ margin: '0.5rem' }}>View Contests</button>
          </Link>
          <Link to="/profile">
            <button style={{ margin: '0.5rem' }}>Edit Profile</button>
          </Link>
        </div>
        
        <div style={{ 
          padding: '1rem', 
          border: '1px solid #ddd', 
          borderRadius: '8px' 
        }}>
          <h3>Recent Activity</h3>
          <p>No recent activity</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;