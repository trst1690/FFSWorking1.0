// frontend/src/components/Auth/Login.js
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { login, clearError, selectAuthLoading, selectAuthError } from '../../store/slices/authSlice';

const Login = () => {
  const [username, setUsername] = useState(''); // Changed from email to username
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const isMountedRef = useRef(true);
  
  // Get loading and error from Redux
  const loading = useSelector(selectAuthLoading);
  const authError = useSelector(selectAuthError);
  
  useEffect(() => {
    // Set mounted flag
    isMountedRef.current = true;
    
    // Clear any existing errors when component mounts
    dispatch(clearError());
    
    // Cleanup function
    return () => {
      isMountedRef.current = false;
    };
  }, [dispatch]);
  
  // Update local error when auth error changes
  useEffect(() => {
    if (authError) {
      setLocalError(authError);
    }
  }, [authError]);
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    
    try {
      // Dispatch the login action with username
      const resultAction = await dispatch(login({ 
        username,
        password 
      }));
      
      if (login.fulfilled.match(resultAction)) {
        // Login successful, navigation will be handled by the PublicRoute redirect
        console.log('Login successful');
      } else {
        // Login failed
        if (isMountedRef.current) {
          setLocalError(resultAction.payload || 'Login failed');
        }
      }
    } catch (err) {
      if (isMountedRef.current) {
        setLocalError('Login failed. Please try again.');
      }
    }
  };
  
  return (
    <div style={{ maxWidth: '400px', margin: '2rem auto', padding: '2rem' }}>
      <h2>Login</h2>
      
      {localError && (
        <div style={{ 
          color: '#dc3545', 
          backgroundColor: '#f8d7da',
          border: '1px solid #f5c6cb',
          borderRadius: '4px',
          padding: '12px',
          marginBottom: '1rem' 
        }}>
          {localError}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Username:
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              style={{ 
                display: 'block', 
                width: '100%', 
                marginTop: '0.5rem',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
            />
          </label>
        </div>
        
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            Password:
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{ 
                display: 'block', 
                width: '100%', 
                marginTop: '0.5rem',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
            />
          </label>
        </div>
        
        <button 
          type="submit" 
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: loading ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '16px'
          }}
        >
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
      
      <p style={{ marginTop: '1rem', textAlign: 'center' }}>
        Don't have an account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
};

export default Login;