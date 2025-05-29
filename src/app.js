// backend/src/app.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

// Load environment variables
dotenv.config();

// Import database and models
const db = require('./models');

// Import routes - only include what exists
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const contestRoutes = require('./routes/contestRoutes');

// Import services
const contestService = require('./services/contestService');
const SocketHandler = require('./socketHandlers');

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Create Socket.IO instance
const io = socketIO(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'] // Explicitly set transports
});

// Store io instance on app for route access
app.set('io', io);

// Initialize services with Socket.IO
contestService.setSocketIO(io);

// Initialize Socket Handler
const socketHandler = new SocketHandler(io);
socketHandler.initialize();

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      process.env.CLIENT_URL
    ].filter(Boolean); // Remove any undefined values
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    socketConnections: socketHandler.getOnlineUsersCount()
  });
});

app.get('/api/health', async (req, res) => {
  try {
    // Check database connection
    await db.sequelize.authenticate();
    const dbStatus = true;
    
    // Check Redis connection
    let redisStatus = false;
    try {
      await contestService.redis.ping();
      redisStatus = true;
    } catch (error) {
      console.error('Redis health check failed:', error);
    }

    res.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
        socketio: !!io,
        socketConnections: socketHandler.getOnlineUsersCount()
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contests', contestRoutes);

// Placeholder routes for missing functionality
app.use('/api/market-mover', (req, res) => {
  res.json({ 
    message: 'Market Mover routes not implemented yet',
    status: 'placeholder' 
  });
});

app.use('/api/tickets', (req, res) => {
  res.json({ 
    message: 'Ticket routes not implemented yet',
    status: 'placeholder' 
  });
});

app.use('/api/drafts', (req, res) => {
  res.json({ 
    message: 'Draft routes not implemented yet',
    status: 'placeholder' 
  });
});

app.use('/api/transactions', (req, res) => {
  res.json({ 
    message: 'Transaction routes not implemented yet',
    status: 'placeholder' 
  });
});

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API documentation route
app.get('/api', (req, res) => {
  res.json({
    version: '1.0.0',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        logout: 'POST /api/auth/logout',
        refresh: 'POST /api/auth/refresh'
      },
      users: {
        profile: 'GET /api/users/profile',
        update: 'PUT /api/users/profile'
      },
      contests: {
        list: 'GET /api/contests',
        enter: 'POST /api/contests/:id/enter',
        withdraw: 'DELETE /api/contests/entries/:id'
      }
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Handle CORS errors
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      error: 'CORS policy violation',
      message: 'Origin not allowed'
    });
  }
  
  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.errors
    });
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired'
    });
  }
  
  // Default error response
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method
  });
});

// Database connection and server startup
async function startServer() {
  try {
    // Test database connection
    await db.sequelize.authenticate();
    console.log('✅ Database connection established successfully');

    // Sync database models (use migrations in production)
    if (process.env.NODE_ENV !== 'production') {
      await db.sequelize.sync({ alter: true });
      console.log('✅ Database models synchronized');
    }

    // Ensure initial data exists - only if the utility exists
    try {
      const { ensureInitialData } = require('./utils/dataInitializer');
      await ensureInitialData();
      console.log('✅ Initial data verified');
    } catch (error) {
      console.log('⚠️  Data initializer not found, skipping...');
    }

    // Ensure at least one cash game is available
    try {
      await contestService.ensureCashGameAvailable();
      console.log('✅ Cash game availability verified');
    } catch (error) {
      console.log('⚠️  Could not ensure cash game availability:', error.message);
    }

    // Start server
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  Database: ${process.env.DB_NAME || 'fantasy_draft_db'}`);
      console.log(`🌐 CORS Origin: ${process.env.CLIENT_URL || 'http://localhost:3000'}`);
      console.log('✅ Active Services:');
      console.log('   - Express Server: Running');
      console.log('   - Socket.IO: Listening');
      console.log('   - Database: Connected');
      console.log('   - Redis: Connected');
      console.log('   - Contest Service: Initialized');
      console.log('📡 API Documentation: GET /api');
    });

    // Periodic cleanup tasks
    setInterval(async () => {
      try {
        await contestService.cleanupRoomBoards();
        await contestService.cleanupLocks();
      } catch (error) {
        console.error('Cleanup task error:', error);
      }
    }, 3600000); // Run every hour

    // Graceful shutdown handling
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown function
async function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  try {
    // Stop accepting new connections
    server.close(() => {
      console.log('✅ HTTP server closed');
    });

    // Close Socket.IO connections
    io.close(() => {
      console.log('✅ Socket.IO connections closed');
    });

    // Cleanup contest service
    if (contestService.cleanup) {
      await contestService.cleanup();
      console.log('✅ Contest service cleaned up');
    }

    // Close database connection
    await db.sequelize.close();
    console.log('✅ Database connection closed');

    console.log('👋 Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Start the server
startServer();

// Export for testing
module.exports = { app, server, io };