// frontend/src/App.js
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { store } from './store/store';
import { checkAuth, selectAuthUser, selectIsAuthenticated, selectAuthLoading } from './store/slices/authSlice';
import './utils/axiosConfig';
import './App.css';

// Import components
import Header from './components/Header/Header';
import LandingPage from './components/Landing/LandingPage';
import Login from './components/Auth/Login';
import Register from './components/Auth/Register';
import Dashboard from './components/Dashboard/Dashboard';
import LobbyScreen from './components/Lobby/LobbyScreen';
import DraftScreen from './components/Draft/DraftScreen';
import ProfileScreen from './components/Profile/ProfileScreen';
import AdminPanel from './components/Admin/AdminPanel';
import ToastContainer from './components/Toast/ToastContainer';

// Protected Route Component
const ProtectedRoute = ({ children, requireAdmin = false }) => {
  const user = useSelector(selectAuthUser);
  const isAuthenticated = useSelector(selectIsAuthenticated);
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  if (requireAdmin && user?.role !== 'admin') {
    return <Navigate to="/dashboard" />;
  }
  
  return children;
};

// Public Route Component (redirects to dashboard if authenticated)
const PublicRoute = ({ children }) => {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" />;
  }
  
  return children;
};

// App Content Component (uses Redux hooks)
const AppContent = () => {
  const dispatch = useDispatch();
  const loading = useSelector(selectAuthLoading);

  // Check authentication on mount
  useEffect(() => {
    dispatch(checkAuth());
  }, [dispatch]);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Loading Fantasy Fire Sale...</p>
      </div>
    );
  }

  return (
    <Router>
      <div className="App">
        <Header />
        
        <main className="main-content">
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            
            <Route path="/login" element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            } />
            
            <Route path="/register" element={
              <PublicRoute>
                <Register />
              </PublicRoute>
            } />
            
            {/* Protected routes */}
            <Route path="/dashboard" element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } />
            
            <Route path="/lobby" element={
              <ProtectedRoute>
                <LobbyScreen />
              </ProtectedRoute>
            } />
            
            <Route path="/draft/:roomId" element={
              <ProtectedRoute>
                <DraftScreen />
              </ProtectedRoute>
            } />
            
            <Route path="/profile" element={
              <ProtectedRoute>
                <ProfileScreen />
              </ProtectedRoute>
            } />
            
            {/* Admin routes */}
            <Route path="/admin" element={
              <ProtectedRoute requireAdmin={true}>
                <AdminPanel />
              </ProtectedRoute>
            } />
            
            {/* 404 route */}
            <Route path="*" element={
              <div className="not-found">
                <h1>404 - Page Not Found</h1>
                <p>The page you're looking for doesn't exist.</p>
                <a href="/">Go Home</a>
              </div>
            } />
          </Routes>
        </main>
        
        {/* Toast notifications */}
        <ToastContainer />
      </div>
    </Router>
  );
};

// Main App Component with Provider
function App() {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
}

export default App;