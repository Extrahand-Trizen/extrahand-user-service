import axios from 'axios';
import { validateEnv } from '../config/env';
import logger from '../config/logger';

const env = validateEnv();

interface TaskStats {
  totalTasks: number;
  completedTasks: number;
  postedTasks: number;
}

interface ReviewStats {
  totalReviews: number;
  avgRating: number;
  ratingBreakdowns?: {
    communication: number;
    quality: number;
    timeliness: number;
    professionalism: number;
    value: number;
  };
}

export class StatsService {
  private taskServiceUrl: string;
  private serviceAuthToken: string;

  constructor() {
    this.taskServiceUrl = env.TASK_SERVICE_URL;
    this.serviceAuthToken = env.SERVICE_AUTH_TOKEN || '';
  }

  private getDefaultStats() {
    return {
      totalTasks: 0,
      completedTasks: 0,
      postedTasks: 0,
      totalReviews: 0,
      avgRating: 0,
      ratingBreakdowns: undefined,
    };
  }

  private async fetchConsolidatedStats(profileId: string, uid: string) {
    try {
      if (!this.taskServiceUrl || !this.serviceAuthToken) {
        logger.warn('Task service not configured, returning zero stats');
        return this.getDefaultStats();
      }

      const headers = {
        'x-service-auth': this.serviceAuthToken,
        'x-service-name': 'user-service',
      };

      const response = await axios.get(`${this.taskServiceUrl}/api/v1/stats/users/${profileId}`, {
        params: { uid },
        headers,
        timeout: 5000,
      });

      const payload = response.data?.data || response.data || {};

      return {
        totalTasks: Number(payload.totalTasks ?? 0),
        completedTasks: Number(payload.completedTasks ?? 0),
        postedTasks: Number(payload.postedTasks ?? 0),
        totalReviews: Number(payload.totalReviews ?? 0),
        avgRating: Number(payload.avgRating ?? payload.rating ?? 0),
        ratingBreakdowns: payload.ratingBreakdowns ?? undefined,
      };
    } catch (error: any) {
      logger.error('Error fetching consolidated profile stats from task-service', {
        profileId,
        message: error.message,
      });
      return this.getDefaultStats();
    }
  }

  /**
   * Calculate task statistics by querying the consolidated task-service stats endpoint.
   */
  async calculateTaskStats(profileId: string, uid: string): Promise<TaskStats> {
    const stats = await this.fetchConsolidatedStats(profileId, uid);

    return {
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      postedTasks: stats.postedTasks,
    };
  }

  /**
   * Calculate review statistics by querying the consolidated task-service stats endpoint.
   */
  async calculateReviewStats(profileId: string, uid?: string): Promise<ReviewStats> {
    const stats = await this.fetchConsolidatedStats(profileId, uid || profileId);

    return {
      totalReviews: stats.totalReviews,
      avgRating: stats.avgRating,
      ratingBreakdowns: undefined,
    };
  }

  /**
   * Calculate all profile statistics.
   */
  async calculateAllStats(profileId: string, uid: string) {
    return this.fetchConsolidatedStats(profileId, uid);
  }
}

export const statsService = new StatsService();
