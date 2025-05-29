// frontend/src/components/Admin/AdminPanel.js
import React from 'react';

const AdminPanel = ({ user, showToast }) => {
  return (
    <div style={{ padding: '2rem' }}>
      <h1>Admin Panel</h1>
      <p>Welcome, Admin {user?.username}!</p>
      
      <div style={{ marginTop: '2rem' }}>
        <h3>Quick Stats</h3>
        <p>This is a placeholder admin panel.</p>
        <p>Admin features will be implemented here.</p>
      </div>
    </div>
  );
};

export default AdminPanel;