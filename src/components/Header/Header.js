// frontend/src/components/Header/Header.js
import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { selectAuthUser, selectIsAuthenticated, logout } from '../../store/slices/authSlice';
import { showToast } from '../../store/slices/uiSlice';
import './Header.css';

const Header = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectAuthUser);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  
  // Debug line to check user data
  console.log('Header user data:', user);

  const handleLogout = () => {
    dispatch(logout());
    dispatch(showToast({ message: 'Logged out successfully', type: 'info' }));
    navigate('/');
  };

  return (
    <header className="header">
      <div className="header-container">
        <Link to="/" className="logo">
          Fantasy Fire Sale
        </Link>
        
        <nav className="nav">
          {isAuthenticated ? (
            <>
              <Link to="/dashboard">Dashboard</Link>
              <Link to="/lobby">Lobby</Link>
              <Link to="/profile">Profile</Link>
              {user?.role === 'admin' && (
                <Link to="/admin">Admin</Link>
              )}
              <div className="user-info">
                <span className="balance">${Number(user?.balance || 0).toFixed(2)}</span>
                <span className="username">{user?.username}</span>
                <button onClick={handleLogout} className="logout-btn">
                  Logout
                </button>
              </div>
            </>
          ) : (
            <>
              <Link to="/login">Login</Link>
              <Link to="/register">Register</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
};

export default Header;