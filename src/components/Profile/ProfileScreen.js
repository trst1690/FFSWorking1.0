// frontend/src/components/Profile/ProfileScreen.js
import React, { useState } from 'react';
import axios from 'axios';

const ProfileScreen = ({ user, showToast, updateUser }) => {
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    bio: user?.bio || '',
    email_notifications: user?.email_notifications || true,
    draft_reminders: user?.draft_reminders || true,
    sound_enabled: user?.sound_enabled || true
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFormData({
      ...formData,
      [e.target.name]: value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await axios.put('/api/users/profile', formData);
      if (response.data.success) {
        updateUser(response.data.data);
        showToast('Profile updated successfully', 'success');
        setEditing(false);
      }
    } catch (error) {
      showToast(error.response?.data?.error || 'Failed to update profile', 'error');
    }

    setLoading(false);
  };

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '2rem' }}>
      <h1>Profile</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <h3>Account Information</h3>
        <p><strong>Username:</strong> {user?.username}</p>
        <p><strong>Email:</strong> {user?.email}</p>
        <p><strong>Balance:</strong> ${user?.balance || 0}</p>
        <p><strong>Member Since:</strong> {new Date(user?.created_at || Date.now()).toLocaleDateString()}</p>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h3>Statistics</h3>
        <p><strong>Total Contests:</strong> {user?.total_contests_entered || 0}</p>
        <p><strong>Contests Won:</strong> {user?.total_contests_won || 0}</p>
        <p><strong>Win Rate:</strong> {user?.win_rate || 0}%</p>
        <p><strong>Total Winnings:</strong> ${user?.total_prize_money || 0}</p>
        <p><strong>Highest Score:</strong> {user?.highest_score || 0}</p>
      </div>

      <div>
        <h3>Settings</h3>
        {!editing ? (
          <div>
            <p><strong>Bio:</strong> {user?.bio || 'No bio set'}</p>
            <p><strong>Email Notifications:</strong> {user?.email_notifications ? 'Enabled' : 'Disabled'}</p>
            <p><strong>Draft Reminders:</strong> {user?.draft_reminders ? 'Enabled' : 'Disabled'}</p>
            <p><strong>Sound Effects:</strong> {user?.sound_enabled ? 'Enabled' : 'Disabled'}</p>
            <button onClick={() => setEditing(true)}>Edit Settings</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '1rem' }}>
              <label>
                Bio:
                <textarea
                  name="bio"
                  value={formData.bio}
                  onChange={handleChange}
                  rows="4"
                  style={{ display: 'block', width: '100%', marginTop: '0.5rem' }}
                />
              </label>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <label>
                <input
                  type="checkbox"
                  name="email_notifications"
                  checked={formData.email_notifications}
                  onChange={handleChange}
                />
                Email Notifications
              </label>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <label>
                <input
                  type="checkbox"
                  name="draft_reminders"
                  checked={formData.draft_reminders}
                  onChange={handleChange}
                />
                Draft Reminders
              </label>
            </div>
            
            <div style={{ marginBottom: '1rem' }}>
              <label>
                <input
                  type="checkbox"
                  name="sound_enabled"
                  checked={formData.sound_enabled}
                  onChange={handleChange}
                />
                Sound Effects
              </label>
            </div>
            
            <button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditing(false)} style={{ marginLeft: '1rem' }}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ProfileScreen;