// backend/src/models/playerScore.js
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PlayerScore = sequelize.define('PlayerScore', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    player_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    player_team: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    week: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    season: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    stats: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    fantasy_points: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'player_scores',
    timestamps: false,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['player_name', 'player_team', 'week', 'season']
      }
    ]
  });

  return PlayerScore;
};