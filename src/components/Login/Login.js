// frontend/src/components/Login/LoginScreen.js
import React, { useState } from 'react';
import './Login.css';

const LoginScreen = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const endpoint = isLogin ? 'login' : 'register';
    const body = isLogin 
      ? { username, password }
      : { username, email, password };

    console.log(`Attempting ${endpoint} with:`, body);

    try {
      const response = await fetch(`http://localhost:5000/api/auth/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      console.log('Auth response:', data);

      if (response.ok) {
        console.log('Success! Calling onLogin...');
        // Pass the user data and token to the parent component
        onLogin(data.user, data.token);
      } else {
        setError(data.error || 'Authentication failed');
        console.error('Auth error:', data.error);
      }
    } catch (error) {
      console.error('Network error:', error);
      setError('Network error. Please try again.');
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError('');
    // Clear form
    setUsername('');
    setEmail('');
    setPassword('');
  };

  return (
    <div className="login-screen">
      <div className="login-container">
        <h1 className="login-title">FANTASY DRAFT</h1>
        <h2 className="login-subtitle">{isLogin ? 'Login' : 'Register'}</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="login-input"
            autoComplete="username"
          />
          
          {!isLogin && (
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="login-input"
              autoComplete="email"
            />
          )}
          
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="login-input"
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
          
          <button type="submit" className="login-button">
            {isLogin ? 'LOGIN' : 'REGISTER'}
          </button>
        </form>
        
        <button onClick={toggleMode} className="toggle-button">
          {isLogin ? 'Need to register?' : 'Already have an account?'}
        </button>
      </div>
    </div>
  );
};

export default LoginScreen;