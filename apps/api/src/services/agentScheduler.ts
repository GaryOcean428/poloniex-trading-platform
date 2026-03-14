/**
 * Agent Scheduler
 * 
 * Background job scheduler for autonomous agents
 * - Restores agent sessions from PostgreSQL on startup
 * - Starts agents in "always" mode
 * - Restarts agents after server restart
 * - Monitors agent health
 */

import * as cron from 'node-cron';
import { pool } from '../db/connection.js';
import { autonomousTradingAgent } from './autonomousTradingAgent.js';
import { agentSettingsService } from './agentSettingsService.js';
import { logger } from '../utils/logger.js';

class AgentScheduler {
  private jobs: Map<string, any> = new Map();
  private isRunning = false;

  /**
   * Start the scheduler
   */
  async start() {
    if (this.isRunning) {
      logger.warn('Agent scheduler is already running');
      return;
    }

    logger.info('Starting agent scheduler...');
    this.isRunning = true;

    // Restore agent sessions that were running before server restart
    await autonomousTradingAgent.restoreRunningSessionsFromDB();

    // Check every minute for agents that should be running
    const checkJob = cron.schedule('* * * * *', async () => {
      await this.checkAndStartAgents();
    });

    this.jobs.set('check-agents', checkJob);

    // Restart agents from agent_settings (always-run mode)
    await this.restartPersistentAgents();

    logger.info('Agent scheduler started successfully');
  }

  /**
   * Stop the scheduler
   */
  stop() {
    logger.info('Stopping agent scheduler...');
    
    for (const [name, job] of this.jobs.entries()) {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    }

    this.jobs.clear();
    this.isRunning = false;
    
    logger.info('Agent scheduler stopped');
  }

  /**
   * Check for agents that should be running
   */
  private async checkAndStartAgents() {
    try {
      // Get all users with "always" run mode
      const alwaysRunUsers = await agentSettingsService.getAlwaysRunUsers();

      for (const userId of alwaysRunUsers) {
        try {
          // Check if agent is already running
          const status = await autonomousTradingAgent.getAgentStatus(userId);
          
          if (!status || status.status !== 'running') {
            logger.info(`Starting persistent agent for user ${userId}`);
            
            // Get user's agent settings
            const settings = await agentSettingsService.getSettings(userId);
            
            if (settings && settings.config) {
              await autonomousTradingAgent.startAgent(userId, settings.config);
              await agentSettingsService.updateActiveStatus(userId, true);
            }
          }
        } catch (error) {
          logger.error(`Error starting agent for user ${userId}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error in checkAndStartAgents:', error);
    }
  }

  /**
   * Restart agents that were running when server stopped
   */
  private async restartPersistentAgents() {
    try {
      logger.info('Restarting persistent agents from settings...');

      const result = await pool.query(`
        SELECT user_id, config
        FROM agent_settings
        WHERE run_mode = 'always' 
          AND is_active = true
      `);

      for (const row of result.rows) {
        try {
          // Check if already restored by restoreRunningSessionsFromDB
          const existing = await autonomousTradingAgent.getAgentStatus(row.user_id);
          if (existing && existing.status === 'running') {
            logger.info(`Agent already running for user ${row.user_id} (restored from session)`);
            continue;
          }

          logger.info(`Restarting persistent agent for user ${row.user_id}`);
          await autonomousTradingAgent.startAgent(row.user_id, row.config);
        } catch (error) {
          logger.error(`Error restarting agent for user ${row.user_id}:`, error);
        }
      }

      logger.info(`Processed ${result.rows.length} persistent agent settings`);
    } catch (error) {
      logger.error('Error restarting persistent agents:', error);
    }
  }

  /**
   * Start agent for a specific user (called on login if auto-start enabled)
   */
  async startAgentOnLogin(userId: string) {
    try {
      const settings = await agentSettingsService.getSettings(userId);
      
      if (!settings) {
        return;
      }

      // Check if auto-start is enabled
      if (!settings.autoStartOnLogin) {
        return;
      }

      // Check if agent is already running
      const status = await autonomousTradingAgent.getAgentStatus(userId);
      if (status && status.status === 'running') {
        logger.info(`Agent already running for user ${userId}`);
        return;
      }

      logger.info(`Auto-starting agent for user ${userId} on login`);
      await autonomousTradingAgent.startAgent(userId, settings.config);
      await agentSettingsService.updateActiveStatus(userId, true);
    } catch (error) {
      logger.error(`Error auto-starting agent for user ${userId}:`, error);
    }
  }

  /**
   * Stop agent for a specific user (called on logout if not in always mode)
   */
  async stopAgentOnLogout(userId: string) {
    try {
      const settings = await agentSettingsService.getSettings(userId);
      
      if (!settings) {
        return;
      }

      // Don't stop if in always mode and continue when logged out is enabled
      if (settings.runMode === 'always' && settings.continueWhenLoggedOut) {
        logger.info(`Agent will continue running for user ${userId} (always mode)`);
        return;
      }

      // Get current agent status
      const status = await autonomousTradingAgent.getAgentStatus(userId);
      if (!status || status.status !== 'running') {
        return;
      }

      logger.info(`Stopping agent for user ${userId} on logout`);
      await autonomousTradingAgent.stopAgent(status.id);
      await agentSettingsService.updateActiveStatus(userId, false);
    } catch (error) {
      logger.error(`Error stopping agent for user ${userId}:`, error);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys())
    };
  }
}

export const agentScheduler = new AgentScheduler();
export default agentScheduler;
