// frontend/src/store/slices/contestSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

// Async thunks
export const fetchContests = createAsyncThunk(
  'contest/fetchContests',
  async (_, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API_URL}/api/contests`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.contests;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

export const enterContest = createAsyncThunk(
  'contest/enter',
  async ({ contestId }, { rejectWithValue }) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(
        `${API_URL}/api/contests/${contestId}/enter`,
        {},
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      return response.data;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || error.message);
    }
  }
);

const initialState = {
  contests: [],
  selectedContest: null,
  loading: false,
  error: null
};

const contestSlice = createSlice({
  name: 'contest',
  initialState,
  reducers: {
    selectContest: (state, action) => {
      state.selectedContest = action.payload;
    },
    updateContest: (state, action) => {
      const index = state.contests.findIndex(c => c.id === action.payload.id);
      if (index !== -1) {
        state.contests[index] = { ...state.contests[index], ...action.payload };
      }
    },
    clearError: (state) => {
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch contests
      .addCase(fetchContests.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchContests.fulfilled, (state, action) => {
        state.loading = false;
        state.contests = action.payload;
      })
      .addCase(fetchContests.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Enter contest
      .addCase(enterContest.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(enterContest.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(enterContest.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      });
  }
});

export const { selectContest, updateContest, clearError } = contestSlice.actions;

export default contestSlice.reducer;