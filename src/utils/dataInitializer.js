// backend/src/utils/dataInitializer.js
const db = require('../models');
const { generatePlayerBoard } = require('./gameLogic');
const { Op } = require('sequelize');

async function ensureInitialData() {
  try {
    console.log('Checking initial data...');

    // Check if we have any contests
    const contestCount = await db.Contest.count();
    
    if (contestCount === 0) {
      console.log('No contests found. Creating initial contests...');
      await createInitialContests();
    } else {
      console.log(`Found ${contestCount} existing contests`);
      
      // Ensure we have at least one open contest of each type
      await ensureContestTypes();
    }

    // Clean up any orphaned entries
    await cleanupOrphanedEntries();

  } catch (error) {
    console.error('Error ensuring initial data:', error);
    throw error;
  }
}

async function createInitialContests() {
  const transaction = await db.sequelize.transaction();
  
  try {
    // Create Cash Game
    const cashGame = await db.Contest.create({
      type: 'cash',
      name: 'Cash Game #1',
      status: 'open',
      entry_fee: 5.00,
      prize_pool: 25.00,
      max_entries: 5,
      current_entries: 0,
      max_entries_per_user: 1,
      player_board: generatePlayerBoard(),
      start_time: new Date(),
      end_time: new Date(Date.now() + 7200000), // 2 hours from now
      scoring_type: 'standard',
      max_salary: 15,
      prizes: [25]
    }, { transaction });

    console.log('✅ Created Cash Game #1');

    // Create Daily Bash
    const dailyBash = await db.Contest.create({
      type: 'bash',
      name: 'Daily Bash',
      status: 'open',
      entry_fee: 0.00,
      prize_pool: 50000.00,
      max_entries: 1000,
      current_entries: 0,
      max_entries_per_user: 150,
      player_board: generatePlayerBoard(), // Same board for all Bash drafts
      start_time: new Date(),
      end_time: new Date(Date.now() + 86400000), // 24 hours from now
      scoring_type: 'standard',
      max_salary: 15,
      prizes: [10000, 7500, 5000, 3000, 2000] // Top 5 prizes
    }, { transaction });

    console.log('✅ Created Daily Bash');

    // Create Market Mover
    const marketMover = await db.Contest.create({
      type: 'market',
      name: 'Market Mover',
      status: 'open',
      entry_fee: 0.00,
      prize_pool: 10000.00,
      max_entries: 1000,
      current_entries: 0,
      max_entries_per_user: 150,
      player_board: null, // Each room gets unique board
      start_time: new Date(),
      end_time: new Date(Date.now() + 86400000), // 24 hours from now
      scoring_type: 'standard',
      max_salary: 15,
      prizes: [3000, 2000, 1500, 1000, 750]
    }, { transaction });

    console.log('✅ Created Market Mover');

    // Create Trading Floor Firesale
    const firesale = await db.Contest.create({
      type: 'firesale',
      name: 'Trading Floor Firesale',
      status: 'open',
      entry_fee: 1.00,
      prize_pool: 100.00,
      max_entries: 100,
      current_entries: 0,
      max_entries_per_user: 150,
      player_board: generatePlayerBoard(),
      start_time: new Date(),
      end_time: new Date(Date.now() + 14400000), // 4 hours from now
      scoring_type: 'standard',
      max_salary: 15,
      prizes: [50, 25, 15, 10]
    }, { transaction });

    console.log('✅ Created Trading Floor Firesale');

    await transaction.commit();
    console.log('✅ All initial contests created successfully');

  } catch (error) {
    await transaction.rollback();
    console.error('Error creating initial contests:', error);
    throw error;
  }
}

async function ensureContestTypes() {
  try {
    // Check for open cash game
    const openCashGame = await db.Contest.findOne({
      where: {
        type: 'cash',
        status: 'open'
      }
    });

    if (!openCashGame) {
      console.log('No open cash game found. Creating one...');
      
      // Find highest cash game number
      const cashGames = await db.Contest.findAll({
        where: {
          type: 'cash',
          name: { [Op.like]: 'Cash Game #%' }
        },
        attributes: ['name']
      });

      let maxNumber = 0;
      cashGames.forEach(game => {
        const match = game.name.match(/Cash Game #(\d+)/);
        if (match) {
          maxNumber = Math.max(maxNumber, parseInt(match[1]));
        }
      });

      await db.Contest.create({
        type: 'cash',
        name: `Cash Game #${maxNumber + 1}`,
        status: 'open',
        entry_fee: 5.00,
        prize_pool: 25.00,
        max_entries: 5,
        current_entries: 0,
        max_entries_per_user: 1,
        player_board: generatePlayerBoard(),
        start_time: new Date(),
        end_time: new Date(Date.now() + 7200000),
        scoring_type: 'standard',
        max_salary: 15,
        prizes: [25]
      });

      console.log(`✅ Created Cash Game #${maxNumber + 1}`);
    }

    // Check for open bash contest
    const openBash = await db.Contest.findOne({
      where: {
        type: 'bash',
        status: 'open'
      }
    });

    if (!openBash) {
      console.log('No open Daily Bash found. Checking if we should create one...');
      
      // Check if there's a recently closed bash
      const recentBash = await db.Contest.findOne({
        where: {
          type: 'bash',
          status: 'closed',
          end_time: { [Op.gt]: new Date(Date.now() - 3600000) } // Ended within last hour
        }
      });

      if (!recentBash) {
        await db.Contest.create({
          type: 'bash',
          name: 'Daily Bash',
          status: 'open',
          entry_fee: 0.00,
          prize_pool: 50000.00,
          max_entries: 1000,
          current_entries: 0,
          max_entries_per_user: 150,
          player_board: generatePlayerBoard(),
          start_time: new Date(),
          end_time: new Date(Date.now() + 86400000),
          scoring_type: 'standard',
          max_salary: 15,
          prizes: [10000, 7500, 5000, 3000, 2000]
        });

        console.log('✅ Created new Daily Bash');
      }
    }

    // Check for open market mover
    const openMarket = await db.Contest.findOne({
      where: {
        type: 'market',
        status: 'open'
      }
    });

    if (!openMarket) {
      console.log('No open Market Mover found. Creating one...');
      
      await db.Contest.create({
        type: 'market',
        name: 'Market Mover',
        status: 'open',
        entry_fee: 0.00,
        prize_pool: 10000.00,
        max_entries: 1000,
        current_entries: 0,
        max_entries_per_user: 150,
        player_board: null,
        start_time: new Date(),
        end_time: new Date(Date.now() + 86400000),
        scoring_type: 'standard',
        max_salary: 15,
        prizes: [3000, 2000, 1500, 1000, 750]
      });

      console.log('✅ Created new Market Mover');
    }

  } catch (error) {
    console.error('Error ensuring contest types:', error);
    throw error;
  }
}

async function cleanupOrphanedEntries() {
  try {
    // Find entries for non-existent contests
    const orphanedEntries = await db.ContestEntry.findAll({
      include: [{
        model: db.Contest,
        required: false
      }],
      where: {
        '$Contest.id$': null
      }
    });

    if (orphanedEntries.length > 0) {
      console.log(`Found ${orphanedEntries.length} orphaned entries. Cleaning up...`);
      
      for (const entry of orphanedEntries) {
        await entry.destroy();
      }
      
      console.log('✅ Cleaned up orphaned entries');
    }

    // Reset contest entry counts
    const contests = await db.Contest.findAll();
    
    for (const contest of contests) {
      const actualCount = await db.ContestEntry.count({
        where: {
          contest_id: contest.id,
          status: { [Op.notIn]: ['cancelled', 'completed'] }
        }
      });

      if (contest.current_entries !== actualCount) {
        console.log(`Fixing entry count for ${contest.name}: ${contest.current_entries} -> ${actualCount}`);
        await contest.update({ current_entries: actualCount });
      }
    }

  } catch (error) {
    console.error('Error cleaning up orphaned entries:', error);
    // Don't throw - this is just cleanup
  }
}

// Create test users for development
async function createTestUsers() {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  try {
    const testUsers = [
      {
        username: 'testuser1',
        email: 'test1@example.com',
        password: 'password123',
        balance: 100.00,
        tickets: 10
      },
      {
        username: 'testuser2',
        email: 'test2@example.com',
        password: 'password123',
        balance: 100.00,
        tickets: 10
      }
    ];

    for (const userData of testUsers) {
      const existingUser = await db.User.findOne({
        where: { email: userData.email }
      });

      if (!existingUser) {
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        
        await db.User.create({
          ...userData,
          password: hashedPassword
        });

        console.log(`✅ Created test user: ${userData.username}`);
      }
    }

  } catch (error) {
    console.error('Error creating test users:', error);
    // Don't throw - test users are optional
  }
}

module.exports = {
  ensureInitialData,
  createInitialContests,
  ensureContestTypes,
  cleanupOrphanedEntries,
  createTestUsers
};