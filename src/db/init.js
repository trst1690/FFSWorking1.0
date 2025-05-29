// backend/src/db/init.js
const db = require('../models');

async function initDatabase() {
  try {
    // Test connection
    await db.sequelize.authenticate();
    console.log('✅ Database connection established successfully.');

    // Sync all models (creates tables)
    await db.sequelize.sync({ alter: true });
    console.log('✅ All models were synchronized successfully.');

    // Create initial contests if they don't exist
    const contestTypes = [
      { type: 'cash', name: 'Cash Game', entry_fee: 5, prize_pool: 25, max_entries: 5, max_entries_per_user: 1 },
      { type: 'bash', name: 'Daily Bash', entry_fee: 10, prize_pool: 50000, max_entries: 10000, max_entries_per_user: 150 },
      { type: 'market', name: 'Market Mover', entry_fee: 25, prize_pool: 1000000, max_entries: 100000, max_entries_per_user: 150 },
      { type: 'firesale', name: 'Trading Floor Firesale', entry_fee: 50, prize_pool: 250000, max_entries: 10000, max_entries_per_user: 150 }
    ];

    for (const contestData of contestTypes) {
      const existingContest = await db.Contest.findOne({ where: { type: contestData.type } });
      
      if (!existingContest) {
        const { generatePlayerBoard } = require('../utils/gameLogic');
        await db.Contest.create({
          type: contestData.type,
          name: contestData.name,
          entry_fee: contestData.entry_fee,
          prize_pool: contestData.prize_pool,
          max_entries: contestData.max_entries,
          max_entries_per_user: contestData.max_entries_per_user,
          player_board: generatePlayerBoard(),
          start_time: new Date()
        });
        console.log(`✅ Created ${contestData.name} contest`);
      }
    }

    console.log('✅ Database initialization complete!');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initDatabase().then(() => process.exit(0));
}

module.exports = initDatabase;