// backend/src/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const contestService = require('../services/contestService');

// Get user's contest history
router.get('/contests', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const contests = await contestService.getUserContestHistory(userId);
        
        res.json({
            success: true,
            contests
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get user's balance history
router.get('/balance-history', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const userService = require('../services/userService');
        const history = await userService.getUserBalanceHistory(userId);
        
        res.json({
            success: true,
            history
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;