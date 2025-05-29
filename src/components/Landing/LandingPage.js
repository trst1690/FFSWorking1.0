// frontend/src/components/Landing/LandingPage.js
import React from 'react';
import { Link } from 'react-router-dom';

const LandingPage = () => {
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Welcome to Fantasy Fire Sale</h1>
      <p>The ultimate fantasy draft game!</p>
      
      <div style={{ marginTop: '2rem' }}>
        <Link to="/login" style={{ margin: '0 1rem' }}>
          <button>Login</button>
        </Link>
        <Link to="/register" style={{ margin: '0 1rem' }}>
          <button>Register</button>
        </Link>
        <Link to="/lobby" style={{ margin: '0 1rem' }}>
          <button>View Lobby</button>
        </Link>
      </div>
    </div>
  );
};

export default LandingPage;