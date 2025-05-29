// frontend/src/store/slices/socketSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  connected: false,
  authenticated: false,
  socketId: null,
  userId: null,
  reconnectAttempts: 0,
  error: null,
  disconnectReason: null
};

const socketSlice = createSlice({
  name: 'socket',
  initialState,
  reducers: {
    setSocketStatus: (state, action) => {
      return { ...state, ...action.payload };
    },
    resetSocketStatus: () => initialState
  }
});

export const { setSocketStatus, resetSocketStatus } = socketSlice.actions;

export default socketSlice.reducer;