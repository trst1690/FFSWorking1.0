// backend/src/services/ticketService.js
const db = require('../models');

class TicketService {
  async initializeUser(userId, startingTickets = 5) {
    // This is now handled in userService.createUser
    console.log(`User ${userId} initialized with ${startingTickets} tickets`);
  }

  async getBalance(userId) {
    try {
      const user = await db.User.findByPk(userId, {
        attributes: ['tickets']
      });
      return user ? parseInt(user.tickets) : 0;
    } catch (error) {
      console.error('Error getting ticket balance:', error);
      return 0;
    }
  }

  async canClaimWeeklyBonus(userId) {
    try {
      const user = await db.User.findByPk(userId, {
        attributes: ['last_weekly_claim']
      });
      
      if (!user || !user.last_weekly_claim) {
        return true;
      }
      
      const lastClaim = new Date(user.last_weekly_claim);
      const now = new Date();
      const daysSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60 * 24);
      
      return daysSinceLastClaim >= 7;
    } catch (error) {
      console.error('Error checking weekly bonus:', error);
      return false;
    }
  }

  async awardDraftCompletion(userId, contestId) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const user = await db.User.findByPk(userId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      
      if (!user) {
        throw new Error('User not found');
      }

      const currentTickets = parseInt(user.tickets);
      const newBalance = currentTickets + 1;
      
      await user.update({ tickets: newBalance }, { transaction });

      await db.TicketTransaction.create({
        user_id: userId,
        type: 'draft_completion',
        amount: 1,
        balance_after: newBalance,
        reason: 'Completed draft'
      }, { transaction });

      await transaction.commit();
      
      return { success: true, newBalance };
    } catch (error) {
      await transaction.rollback();
      console.error('Error awarding draft completion ticket:', error);
      throw error;
    }
  }

  async awardWeeklyLogin(userId) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const user = await db.User.findByPk(userId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      
      if (!user) {
        throw new Error('User not found');
      }

      // Check if can claim
      if (user.last_weekly_claim) {
        const daysSinceLastClaim = (new Date() - new Date(user.last_weekly_claim)) / (1000 * 60 * 60 * 24);
        if (daysSinceLastClaim < 7) {
          const daysRemaining = Math.ceil(7 - daysSinceLastClaim);
          return {
            success: false,
            error: `Weekly bonus already claimed. Try again in ${daysRemaining} days.`,
            nextAvailable: new Date(user.last_weekly_claim.getTime() + 7 * 24 * 60 * 60 * 1000)
          };
        }
      }

      const currentTickets = parseInt(user.tickets);
      const newBalance = currentTickets + 1;
      
      await user.update({
        tickets: newBalance,
        last_weekly_claim: new Date()
      }, { transaction });

      await db.TicketTransaction.create({
        user_id: userId,
        type: 'weekly_bonus',
        amount: 1,
        balance_after: newBalance,
        reason: 'Weekly login bonus'
      }, { transaction });

      await transaction.commit();
      
      return { success: true, newBalance };
    } catch (error) {
      await transaction.rollback();
      console.error('Error awarding weekly bonus:', error);
      throw error;
    }
  }

  async purchaseTickets(userId, amount, paymentInfo = {}) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const user = await db.User.findByPk(userId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      
      if (!user) {
        throw new Error('User not found');
      }

      const currentTickets = parseInt(user.tickets);
      const purchaseAmount = parseInt(amount);
      const newBalance = currentTickets + purchaseAmount;
      
      await user.update({ tickets: newBalance }, { transaction });

      await db.TicketTransaction.create({
        user_id: userId,
        type: 'purchase',
        amount: purchaseAmount,
        balance_after: newBalance,
        reason: `Purchased ${purchaseAmount} tickets`
      }, { transaction });

      await transaction.commit();
      
      return { success: true, newBalance };
    } catch (error) {
      await transaction.rollback();
      console.error('Error purchasing tickets:', error);
      throw error;
    }
  }

  async useTickets(userId, amount, reason) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const user = await db.User.findByPk(userId, {
        lock: transaction.LOCK.UPDATE,
        transaction
      });
      
      if (!user) {
        throw new Error('User not found');
      }

      const currentTickets = parseInt(user.tickets);
      const useAmount = parseInt(amount);
      
      if (currentTickets < useAmount) {
        throw new Error('Insufficient tickets');
      }

      const newBalance = currentTickets - useAmount;
      
      await user.update({ tickets: newBalance }, { transaction });

      await db.TicketTransaction.create({
        user_id: userId,
        type: 'use',
        amount: -useAmount,
        balance_after: newBalance,
        reason
      }, { transaction });

      await transaction.commit();
      
      return newBalance;
    } catch (error) {
      await transaction.rollback();
      console.error('Error using tickets:', error);
      throw error;
    }
  }

  async getTransactionHistory(userId, limit = 50) {
    try {
      const transactions = await db.TicketTransaction.findAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC']],
        limit
      });

      return transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balance_after,
        reason: t.reason,
        timestamp: t.created_at
      }));
    } catch (error) {
      console.error('Error getting ticket history:', error);
      return [];
    }
  }

  async getTicketStats() {
    try {
      const [
        totalTicketsInCirculation,
        ticketsUsedToday,
        ticketsPurchasedToday
      ] = await Promise.all([
        db.User.sum('tickets') || 0,
        db.TicketTransaction.sum('amount', {
          where: {
            type: 'use',
            created_at: {
              [db.Sequelize.Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
            }
          }
        }) || 0,
        db.TicketTransaction.sum('amount', {
          where: {
            type: 'purchase',
            created_at: {
              [db.Sequelize.Op.gte]: new Date(new Date().setHours(0, 0, 0, 0))
            }
          }
        }) || 0
      ]);

      return {
        totalInCirculation: totalTicketsInCirculation,
        usedToday: Math.abs(ticketsUsedToday),
        purchasedToday: ticketsPurchasedToday
      };
    } catch (error) {
      console.error('Error getting ticket stats:', error);
      return {
        totalInCirculation: 0,
        usedToday: 0,
        purchasedToday: 0
      };
    }
  }
}

module.exports = new TicketService();