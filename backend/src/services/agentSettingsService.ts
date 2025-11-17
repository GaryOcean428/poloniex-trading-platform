/**
 * Agent Settings Service
 * 
 * Manages persistent agent configuration and run modes
 */

import { pool } from '../db/connection.js';
import { logger } from '../utils/logger.js';

export interface AgentSettings {
  id: string;
  userId: string;
  runMode: 'never' | 'manual' | 'always';
  autoStartOnLogin: boolean;
  continueWhenLoggedOut: boolean;
  config: any;
  isActive: boolean;
  lastStartedAt?: Date;
  lastStoppedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

class AgentSettingsService {
  /**
   * Get agent settings for a user
   */
  async getSettings(userId: string): Promise<AgentSettings | null> {
    try {
      const result = await pool.query(
        `SELECT * FROM agent_settings WHERE user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        runMode: row.run_mode,
        autoStartOnLogin: row.auto_start_on_login,
        continueWhenLoggedOut: row.continue_when_logged_out,
        config: row.config,
        isActive: row.is_active,
        lastStartedAt: row.last_started_at,
        lastStoppedAt: row.last_stopped_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error('Error getting agent settings:', error);
      throw error;
    }
  }

  /**
   * Save or update agent settings
   */
  async saveSettings(
    userId: string,
    settings: {
      runMode: 'never' | 'manual' | 'always';
      autoStartOnLogin: boolean;
      continueWhenLoggedOut: boolean;
      config: any;
    }
  ): Promise<AgentSettings> {
    try {
      const result = await pool.query(
        `INSERT INTO agent_settings (user_id, run_mode, auto_start_on_login, continue_when_logged_out, config)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE SET
           run_mode = EXCLUDED.run_mode,
           auto_start_on_login = EXCLUDED.auto_start_on_login,
           continue_when_logged_out = EXCLUDED.continue_when_logged_out,
           config = EXCLUDED.config,
           updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [
          userId,
          settings.runMode,
          settings.autoStartOnLogin,
          settings.continueWhenLoggedOut,
          JSON.stringify(settings.config)
        ]
      );

      const row = result.rows[0];
      logger.info(`Agent settings saved for user ${userId}`, { runMode: settings.runMode });

      return {
        id: row.id,
        userId: row.user_id,
        runMode: row.run_mode,
        autoStartOnLogin: row.auto_start_on_login,
        continueWhenLoggedOut: row.continue_when_logged_out,
        config: row.config,
        isActive: row.is_active,
        lastStartedAt: row.last_started_at,
        lastStoppedAt: row.last_stopped_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error('Error saving agent settings:', error);
      throw error;
    }
  }

  /**
   * Update agent active status
   */
  async updateActiveStatus(userId: string, isActive: boolean): Promise<void> {
    try {
      const timestamp = isActive ? 'last_started_at' : 'last_stopped_at';
      
      await pool.query(
        `UPDATE agent_settings 
         SET is_active = $1, ${timestamp} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2`,
        [isActive, userId]
      );

      logger.info(`Agent active status updated for user ${userId}:`, { isActive });
    } catch (error) {
      logger.error('Error updating agent active status:', error);
      throw error;
    }
  }

  /**
   * Get all users with "always" run mode
   */
  async getAlwaysRunUsers(): Promise<string[]> {
    try {
      const result = await pool.query(
        `SELECT user_id FROM agent_settings WHERE run_mode = 'always'`
      );

      return result.rows.map(row => row.user_id);
    } catch (error) {
      logger.error('Error getting always-run users:', error);
      throw error;
    }
  }

  /**
   * Get all users with auto-start on login enabled
   */
  async getAutoStartUsers(): Promise<string[]> {
    try {
      const result = await pool.query(
        `SELECT user_id FROM agent_settings WHERE auto_start_on_login = true`
      );

      return result.rows.map(row => row.user_id);
    } catch (error) {
      logger.error('Error getting auto-start users:', error);
      throw error;
    }
  }

  /**
   * Check if agent should be running for a user
   */
  async shouldAgentRun(userId: string): Promise<boolean> {
    try {
      const settings = await this.getSettings(userId);
      
      if (!settings) {
        return false;
      }

      // Never mode = never run
      if (settings.runMode === 'never') {
        return false;
      }

      // Always mode = always run
      if (settings.runMode === 'always') {
        return true;
      }

      // Manual mode = only run if explicitly started
      return settings.isActive;
    } catch (error) {
      logger.error('Error checking if agent should run:', error);
      return false;
    }
  }
}

export const agentSettingsService = new AgentSettingsService();
export default agentSettingsService;
