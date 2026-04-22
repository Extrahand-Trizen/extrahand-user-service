import axios from 'axios';
import { validateEnv } from '../config/env';

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

  /**
   * Calculate task statistics by querying task-service
   */
  async calculateTaskStats(profileId: string, uid: string): Promise<TaskStats> {
    try {
      if (!this.taskServiceUrl || !this.serviceAuthToken) {
        console.warn('⚠️ Task service not configured, returning zero stats');
        return { totalTasks: 0, completedTasks: 0, postedTasks: 0 };
      }

      const headers = {
        'x-service-auth': this.serviceAuthToken,
        'x-service-name': 'user-service',
      };

      const [assignedTasksResponse, completedTasksResponse, postedTasksResponse] =
        await Promise.all([
          axios.get(`${this.taskServiceUrl}/api/v1/tasks`, {
            params: { assigneeId: profileId, limit: 1 },
            headers,
            timeout: 5000,
          }),
          axios.get(`${this.taskServiceUrl}/api/v1/tasks`, {
            params: { assigneeId: profileId, status: 'completed', limit: 1 },
            headers,
            timeout: 5000,
          }),
          axios.get(`${this.taskServiceUrl}/api/v1/tasks`, {
            params: { posterUid: uid, limit: 1 },
            headers,
            timeout: 5000,
          }),
        ]);

      const totalTasks = Number(
        assignedTasksResponse.data?.meta?.pagination?.total ??
        assignedTasksResponse.data?.pagination?.total ??
        assignedTasksResponse.data?.data?.length ??
        assignedTasksResponse.data?.tasks?.length ??
        0
      );
      const completedTasks = Number(
        completedTasksResponse.data?.meta?.pagination?.total ??
        completedTasksResponse.data?.pagination?.total ??
        completedTasksResponse.data?.data?.length ??
        completedTasksResponse.data?.tasks?.length ??
        0
      );
      const postedTasks = Number(
        postedTasksResponse.data?.meta?.pagination?.total ??
        postedTasksResponse.data?.pagination?.total ??
        postedTasksResponse.data?.data?.length ??
        postedTasksResponse.data?.tasks?.length ??
        0
      );

      console.log(`📊 Calculated task stats for ${uid}:`, {
        totalTasks,
        completedTasks,
        postedTasks,
      });

      return { totalTasks, completedTasks, postedTasks };
    } catch (error: any) {
      console.error('Error calculating task stats:', error.message);
      // Return zeros on error rather than failing
      return { totalTasks: 0, completedTasks: 0, postedTasks: 0 };
    }
  }

  /**
   * Calculate review statistics by querying task-service reviews endpoint
   */
  async calculateReviewStats(profileId: string): Promise<ReviewStats> {
    try {
      if (!this.taskServiceUrl || !this.serviceAuthToken) {
        console.warn('⚠️ Task service not configured, returning zero review stats');
        return { totalReviews: 0, avgRating: 0 };
      }

      const headers = {
        'x-service-auth': this.serviceAuthToken,
        'x-service-name': 'user-service',
      };

      // Query reviews for the user using MongoDB ObjectId (not Firebase UID)
      console.log(`🔍 Querying reviews for profileId: ${profileId}`);
      console.log(`🔍 Review endpoint: ${this.taskServiceUrl}/api/v1/reviews/user/${profileId}`);
      
      const reviewsResponse = await axios.get(
        `${this.taskServiceUrl}/api/v1/reviews/user/${profileId}`,
        {
          headers,
          timeout: 5000,
        }
      );

      console.log(`📦 Reviews response status: ${reviewsResponse.status}`);
      console.log(`📦 Reviews response data:`, JSON.stringify(reviewsResponse.data, null, 2));

      const reviews = reviewsResponse.data?.data || []; // API returns reviews in 'data' field
      const totalReviews = reviews.length;
      
      console.log(`📊 Found ${totalReviews} reviews for profileId ${profileId}`);
      
      if (totalReviews === 0) {
        return { totalReviews: 0, avgRating: 0 };
      }

      // Calculate overall average rating
      const avgRating = reviews.reduce((sum: number, review: any) => sum + (review.rating || 0), 0) / totalReviews;

      // Calculate detailed rating breakdowns if ratings object exists
      const ratingBreakdowns = {
        communication: 0,
        quality: 0,
        timeliness: 0,
        professionalism: 0,
        value: 0,
      };

      let reviewsWithBreakdown = 0;
      reviews.forEach((review: any) => {
        if (review.ratings) {
          reviewsWithBreakdown++;
          ratingBreakdowns.communication += review.ratings.communication || 0;
          ratingBreakdowns.quality += review.ratings.quality || 0;
          ratingBreakdowns.timeliness += review.ratings.timeliness || 0;
          ratingBreakdowns.professionalism += review.ratings.professionalism || 0;
          ratingBreakdowns.value += review.ratings.value || 0;
        }
      });

      // Average the breakdowns
      if (reviewsWithBreakdown > 0) {
        ratingBreakdowns.communication = Math.round((ratingBreakdowns.communication / reviewsWithBreakdown) * 10) / 10;
        ratingBreakdowns.quality = Math.round((ratingBreakdowns.quality / reviewsWithBreakdown) * 10) / 10;
        ratingBreakdowns.timeliness = Math.round((ratingBreakdowns.timeliness / reviewsWithBreakdown) * 10) / 10;
        ratingBreakdowns.professionalism = Math.round((ratingBreakdowns.professionalism / reviewsWithBreakdown) * 10) / 10;
        ratingBreakdowns.value = Math.round((ratingBreakdowns.value / reviewsWithBreakdown) * 10) / 10;
      }

      console.log(`⭐ Calculated review stats for profileId ${profileId}:`, {
        totalReviews,
        avgRating,
        ratingBreakdowns,
      });

      return { 
        totalReviews, 
        avgRating,
        ratingBreakdowns: reviewsWithBreakdown > 0 ? ratingBreakdowns : undefined,
      };
    } catch (error: any) {
      console.error('Error calculating review stats:', error.message);
      // Return zeros on error rather than failing
      return { totalReviews: 0, avgRating: 0 };
    }
  }

  /**
   * Calculate all profile statistics
   */
  async calculateAllStats(profileId: string, uid: string) {
    const [taskStats, reviewStats] = await Promise.all([
      this.calculateTaskStats(profileId, uid),
      this.calculateReviewStats(profileId), // Use profileId for reviews
    ]);

    return {
      ...taskStats,
      ...reviewStats,
    };
  }
}

export const statsService = new StatsService();
