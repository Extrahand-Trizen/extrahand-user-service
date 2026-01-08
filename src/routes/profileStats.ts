import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import Profile from '../models/Profile';

const router = Router();

/**
 * Recalculate statistics for the current user
 * This triggers task-service to recalculate and send back stats
 * POST /api/v1/profiles/me/stats/recalculate
 */
router.post('/recalculate', authMiddleware, async (req: Request, res: Response) => {
  try {
    const uid = req.user?.uid;
    
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const profile = await Profile.findOne({ uid });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found',
      });
    }

    // TODO: Call task-service to trigger stat recalculation
    // For now, return current stats from profile
    return res.status(200).json({
      success: true,
      message: 'Profile statistics (current values - recalculation endpoint pending)',
      data: {
        totalTasks: profile.totalTasks,
        completedTasks: profile.completedTasks,
        postedTasks: profile.postedTasks,
        totalReviews: profile.totalReviews,
        rating: profile.rating,
      },
    });
  } catch (error: any) {
    console.error('Error fetching profile stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to recalculate statistics',
      details: error.message,
    });
  }
});

/**
 * Get profile statistics for any user (public access)
 * GET /api/v1/profiles/:userId/stats
 */
router.get('/:userId/stats', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    // Check if userId is MongoDB ObjectId or Firebase UID
    const isMongoId = /^[0-9a-fA-F]{24}$/.test(userId);
    
    let profile;
    if (isMongoId) {
      profile = await Profile.findById(userId);
    } else {
      profile = await Profile.findOne({ uid: userId });
    }
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found',
      });
    }

    // Calculate real-time stats from task-service
    const { statsService } = await import('../services/StatsService');
    const calculatedStats = await statsService.calculateAllStats(
      profile._id.toString(),
      profile.uid
    );

    return res.status(200).json({
      success: true,
      data: {
        totalTasks: calculatedStats.totalTasks,
        completedTasks: calculatedStats.completedTasks,
        postedTasks: calculatedStats.postedTasks,
        totalReviews: calculatedStats.totalReviews,
        rating: Math.round(calculatedStats.avgRating * 10) / 10, // Round to 1 decimal
        ...(calculatedStats.ratingBreakdowns && {
          ratingBreakdowns: calculatedStats.ratingBreakdowns,
        }),
      },
    });
  } catch (error: any) {
    console.error('Error fetching profile stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      details: error.message,
    });
  }
});

/**
 * Get current profile statistics
 * GET /api/v1/profiles/me/stats
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const uid = req.user?.uid;
    
    if (!uid) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    const profile = await Profile.findOne({ uid });
    
    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Profile not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        totalTasks: profile.totalTasks || 0,
        completedTasks: profile.completedTasks || 0,
        postedTasks: profile.postedTasks || 0,
        totalReviews: profile.totalReviews || 0,
        rating: profile.rating || 0,
      },
    });
  } catch (error: any) {
    console.error('Error fetching profile stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      details: error.message,
    });
  }
});

// /**
//  * Admin route: Batch recalculate all profiles
//  * POST /api/v1/profiles/stats/batch-update
//  */
// router.post('/stats/batch-update', authMiddleware, async (req: Request, res: Response) => {
//   try {
//     // TODO: Add admin check middleware
//     // For now, allow any authenticated user (remove in production)
    
//     // Run batch update in background
//     ProfileService.batchUpdateAllStats().catch((error) => {
//       console.error('Batch update failed:', error);
//     });

//     res.status(202).json({
//       success: true,
//       message: 'Batch statistics update started in background',
//     });
//   } catch (error: any) {
//     console.error('Error starting batch update:', error);
//     res.status(500).json({
//       success: false,
//       error: 'Failed to start batch update',
//       details: error.message,
//     });
//   }
// });

/**
 * Internal service-to-service endpoint: Update stats from task-service
 * PATCH /api/v1/profiles/:profileId/internal/stats
 * Called by task-service after calculating stats
 */
router.patch('/:profileId/internal/stats', async (req: Request, res: Response) => {
  try {
    // Verify service-to-service authentication
    const serviceAuth = req.headers['x-service-auth'];
    const serviceName = req.headers['x-service-name'];
    
    if (!serviceAuth || serviceAuth !== process.env.SERVICE_AUTH_SECRET) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized: Invalid service authentication',
      });
    }

    console.log(`📊 Stats update from ${serviceName} for profile ${req.params.profileId}`);

    // Update profile stats directly
    await Profile.findByIdAndUpdate(
      req.params.profileId,
      {
        $set: {
          totalTasks: req.body.totalTasks,
          completedTasks: req.body.completedTasks,
          postedTasks: req.body.postedTasks,
          totalReviews: req.body.totalReviews,
          rating: req.body.rating,
        }
      },
      { new: true }
    );
    
    return res.status(200).json({
      success: true,
      message: 'Profile statistics updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating stats:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update statistics',
      details: error.message,
    });
  }
});

export default router;
