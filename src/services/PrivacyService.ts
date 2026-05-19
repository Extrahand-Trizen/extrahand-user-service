import Profile from '../models/Profile';
import Consent, { IConsent } from '../models/Consent';
import { NotFoundError, BadRequestError, ServiceUnavailableError } from '../errors/AppError';
import logger from '../config/logger';
import axios from 'axios';
import { validateEnv } from '../config/env';
import { auth } from '../config/firebase';


const env = validateEnv();

export class PrivacyService {
  private static getDeletionAlias(profile: any): string {
    const roles = Array.isArray(profile?.roles) ? profile.roles : [];
    if (roles.includes('tasker')) {
      return 'Tasker (account deleted)';
    }
    return 'Customer (account deleted)';
  }

  private static buildServiceHeaders(userId?: string, profileId?: string): Record<string, string> {
    return {
      'X-Service-Auth': env.SERVICE_AUTH_TOKEN || '',
      'X-Service-Name': 'extrahand-user-service',
      ...(userId ? { 'X-User-Id': userId } : {}),
      ...(profileId ? { 'X-Profile-Id': profileId } : {})
    };
  }

  private static async cascadeDeleteAccountEligibleData(profile: any): Promise<Record<string, number>> {
    const taskServiceUrl = env.TASK_SERVICE_URL;
    if (!taskServiceUrl || !env.SERVICE_AUTH_TOKEN) {
      throw new ServiceUnavailableError(
        'Unable to delete your work data right now. Please try again shortly.',
      );
    }

    const profileId = profile?._id?.toString();
    const userId = profile?.uid;

    try {
      const response = await axios.delete(
        `${taskServiceUrl}/api/v1/cascade-delete/user/${userId}/account-deletion`,
        {
          headers: this.buildServiceHeaders(userId, profileId),
          timeout: 30000,
        },
      );

      const payload = response.data?.data || response.data || {};
      logger.info('User account-deletion eligible data removed via task-service', {
        userId,
        profileId,
        payload,
      });

      return {
        tasksDeleted: Number(payload.tasksDeleted || 0),
        applicationsDeleted: Number(payload.applicationsDeleted || 0),
        reviewsDeleted: Number(payload.reviewsDeleted || 0),
        followsDeleted: Number(payload.followsDeleted || 0),
        reportsDeleted: Number(payload.reportsDeleted || 0),
        questionsDeleted: Number(payload.questionsDeleted || 0),
        totalDeleted: Number(payload.totalDeleted || 0),
      };
    } catch (error: any) {
      logger.error('Failed to delete account-eligible task data before account deletion', {
        userId,
        profileId,
        statusCode: error?.response?.status,
        responseData: error?.response?.data,
        error: error.message,
      });

      throw new ServiceUnavailableError(
        'Unable to delete your work data right now. Please try again shortly.',
      );
    }
  }

  private static async assertNoActiveDeletionBlockers(profile: any): Promise<void> {
    const taskServiceUrl = env.TASK_SERVICE_URL;
    if (!taskServiceUrl || !env.SERVICE_AUTH_TOKEN) {
      throw new ServiceUnavailableError(
        'Unable to verify your work status right now. Please try again shortly.',
      );
    }

    const profileId = profile?._id?.toString();
    const userId = profile?.uid;

    if (!profileId) {
      throw new BadRequestError('Profile not found');
    }

    try {
      const response = await axios.get(
        `${taskServiceUrl}/api/v1/cascade-delete/user/${userId}/active-blockers`,
        {
          headers: this.buildServiceHeaders(userId, profileId),
          timeout: 10000,
        },
      );

      const payload = response.data?.data || response.data || {};
      if (payload?.hasBlockers) {
        throw new BadRequestError(
          'Account cannot be deleted while you have ongoing assigned work. Please complete or cancel active tasks first.',
        );
      }
    } catch (error: any) {
      if (error instanceof BadRequestError) {
        throw error;
      }

      logger.error('Failed to check active deletion blockers', {
        userId,
        profileId,
        statusCode: error?.response?.status,
        responseData: error?.response?.data,
        error: error.message,
      });

      throw new ServiceUnavailableError(
        'Unable to verify your work status right now. Please try again shortly.',
      );
    }
  }

  private static async anonymizeAccountProfile(profile: any, reason?: string): Promise<string> {
    const userId = profile.uid;
    const anonymizedName = this.getDeletionAlias(profile);

    await Promise.all([
      Profile.updateOne(
        { uid: userId },
        {
          $set: {
            name: anonymizedName,
            profession: null,
            location: null,
            savedAddresses: [],
            photoURL: null,
            bio: null,
            portfolio: [],
            business: null,
            maskedAadhaar: null,
            maskedPan: null,
            maskedBankAccount: null,
            bankAccount: null,
            isAadhaarVerified: false,
            aadhaarVerifiedAt: null,
            isPANVerified: false,
            panVerifiedAt: null,
            isBankVerified: false,
            bankVerifiedAt: null,
            isEmailVerified: false,
            emailVerifiedAt: null,
            phoneVerified: false,
            isActive: false,
            status: 'inactive',
            'dataPrivacy.deletionRequested': false,
            'dataPrivacy.deletionRequestedAt': null,
            'dataPrivacy.deletionScheduledFor': null,
            'dataPrivacy.accountDeleted': true,
            'dataPrivacy.accountDeletedAt': new Date(),
            'dataPrivacy.accountDeletionReason':
              reason?.trim() || 'User requested account deletion (DPDP)',
          },
          $unset: {
            email: '',
            phone: '',
          },
        },
      ),
      Consent.deleteOne({ userId }),
    ]);

    return anonymizedName;
  }

  private static async deleteFirebaseAuthUser(userId: string): Promise<void> {
    try {
      await auth.deleteUser(userId);
      logger.info('Firebase account deleted after privacy deletion', { userId });
    } catch (error: any) {
      logger.error('Failed to delete Firebase account after privacy deletion', {
        userId,
        error: error?.message,
        code: error?.code,
      });
    }
  }

  private static async recordDeletionConsent(userId: string, reason?: string): Promise<void> {
    const consent = await Consent.findOne({ userId });
    if (!consent) return;

    consent.consentHistory.push({
      consentType: 'account.deletion',
      action: 'given' as const,
      givenAt: new Date(),
      ipAddress: 'system',
      userAgent: 'system',
      reason: reason || 'User requested account deletion',
    });
    await consent.save();
  }

  /**
   * Export all user data
   */
  static async exportUserData(
    userId: string,
    taskServiceUrl: string,
    messagingServiceUrl: string,
    serviceAuthToken: string
  ): Promise<any> {
    logger.info('📦 Data export requested', { userId });

    // Gather user data from User Service (Profile, Consent)
    const [profile, consent] = await Promise.all([
      Profile.findOne({ uid: userId }).lean(),
      Consent.findOne({ userId }).lean()
    ]);

    // Gather data from other services
    let tasks: any[] = [];
    let applications: any[] = [];
    let chats: any[] = [];
    let reviews: any[] = [];

    try {
      // Get tasks from Task Service
      if (taskServiceUrl) {
        const tasksResponse = await axios.get(
          `${taskServiceUrl}/api/v1/tasks/my-tasks`,
          {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }
        );
        tasks = tasksResponse.data?.tasks || tasksResponse.data || [];
      }
    } catch (error) {
      logger.warn('Failed to fetch tasks from Task Service:', error);
    }

    try {
      // Get applications from Task Service
      if (taskServiceUrl) {
        const appsResponse = await axios.get(
          `${taskServiceUrl}/api/v1/applications`,
          {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }
        );
        applications = appsResponse.data?.applications || appsResponse.data || [];
      }
    } catch (error) {
      logger.warn('Failed to fetch applications from Task Service:', error);
    }

    try {
      // Get chats from Messaging Service
      if (messagingServiceUrl) {
        const chatsResponse = await axios.get(
          `${messagingServiceUrl}/api/v1/chats`,
          {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }
        );
        chats = chatsResponse.data?.chats || chatsResponse.data || [];
      }
    } catch (error) {
      logger.warn('Failed to fetch chats from Messaging Service:', error);
    }

    try {
      // Get reviews from Task Service
      if (taskServiceUrl) {
        const reviewsResponse = await axios.get(
          `${taskServiceUrl}/api/v1/reviews/user/${userId}`,
          {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }
        );
        reviews = reviewsResponse.data?.reviews || reviewsResponse.data || [];
      }
    } catch (error) {
      logger.warn('Failed to fetch reviews from Task Service:', error);
    }

    const exportData = {
      exportDate: new Date().toISOString(),
      exportFormat: 'JSON',
      dataController: {
        name: 'ExtraHand Platform',
        contact: 'privacy@extrahand.in',
        dpo: 'dpo@extrahand.in'
      },
      user: {
        userId,
        profile: profile ? {
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          roles: profile.roles,
          userType: profile.userType,
          location: profile.location,
          skills: profile.skills,
          rating: profile.rating,
          totalReviews: profile.totalReviews,
          totalTasks: profile.totalTasks,
          completedTasks: profile.completedTasks,
          isVerified: profile.isVerified,
          isAadhaarVerified: profile.isAadhaarVerified,
          aadhaarVerifiedAt: profile.aadhaarVerifiedAt,
          onboardingStatus: profile.onboardingStatus,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          lastActive: profile.lastActive
        } : null,
        consent: consent ? {
          consents: consent.consents,
          agreements: consent.agreements,
          communicationPreferences: consent.communicationPreferences,
          consentHistory: consent.consentHistory,
          createdAt: consent.createdAt,
          updatedAt: consent.updatedAt
        } : null,
        tasks: Array.isArray(tasks) ? tasks.map((task: any) => ({
          id: task._id || task.id,
          title: task.title,
          description: task.description,
          category: task.category,
          status: task.status,
          budget: task.budget,
          location: task.location,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        })) : [],
        applications: Array.isArray(applications) ? applications.map((app: any) => ({
          id: app._id || app.id,
          taskId: app.taskId,
          status: app.status,
          proposedPrice: app.proposedPrice || app.proposedBudget,
          message: app.message || app.coverLetter,
          createdAt: app.createdAt
        })) : [],
        chats: Array.isArray(chats) ? chats.map((chat: any) => ({
          id: chat._id || chat.id,
          participants: chat.participants,
          messages: chat.messages,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt
        })) : [],
        reviews: Array.isArray(reviews) ? reviews.map((review: any) => ({
          id: review._id || review.id,
          taskId: review.taskId,
          rating: review.rating,
          comment: review.comment,
          isReviewer: review.reviewerId === userId,
          createdAt: review.createdAt
        })) : []
      },
      metadata: {
        totalTasks: Array.isArray(tasks) ? tasks.length : 0,
        totalApplications: Array.isArray(applications) ? applications.length : 0,
        totalChats: Array.isArray(chats) ? chats.length : 0,
        totalReviews: Array.isArray(reviews) ? reviews.length : 0
      }
    };

    // Update profile with last export date
    if (profile) {
      await Profile.updateOne(
        { uid: userId },
        {
          $set: {
            'dataPrivacy.lastDataExport': new Date()
          }
        }
      );
    }

    // Update consent with export count
    if (consent) {
      await Consent.updateOne(
        { userId },
        {
          $set: { 'dataProcessing.lastExportedAt': new Date() },
          $inc: { 'dataProcessing.exportCount': 1 }
        }
      );
    }

    logger.info('✅ Data export completed', {
      userId,
      totalRecords: exportData.metadata
    });

    return exportData;
  }

  /**
   * Get privacy dashboard
   */
  static async getPrivacyDashboard(
    userId: string,
    taskServiceUrl: string,
    messagingServiceUrl: string,
    serviceAuthToken: string
  ): Promise<any> {
    logger.info('📊 Privacy dashboard requested', { userId });

    const [profile, consent] = await Promise.all([
      Profile.findOne({ uid: userId }).lean(),
      Consent.findOne({ userId }).lean()
    ]);

    // Get counts from other services
    let tasksCount = 0;
    let applicationsCount = 0;
    let chatsCount = 0;
    let reviewsCount = 0;

    try {
      if (taskServiceUrl) {
        const [tasksRes, appsRes, reviewsRes] = await Promise.all([
          axios.get(`${taskServiceUrl}/api/v1/tasks/my-tasks`, {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }).catch(() => ({ data: [] })),
          axios.get(`${taskServiceUrl}/api/v1/applications`, {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }).catch(() => ({ data: [] })),
          axios.get(`${taskServiceUrl}/api/v1/reviews/user/${userId}`, {
            headers: {
              'X-Service-Auth': serviceAuthToken,
              'X-User-Id': userId,
              'X-Service-Name': 'extrahand-user-service'
            }
          }).catch(() => ({ data: [] }))
        ]);

        tasksCount = Array.isArray(tasksRes.data?.tasks || tasksRes.data) ? (tasksRes.data?.tasks || tasksRes.data).length : 0;
        applicationsCount = Array.isArray(appsRes.data?.applications || appsRes.data) ? (appsRes.data?.applications || appsRes.data).length : 0;
        reviewsCount = Array.isArray(reviewsRes.data?.reviews || reviewsRes.data) ? (reviewsRes.data?.reviews || reviewsRes.data).length : 0;
      }
    } catch (error) {
      logger.warn('Failed to fetch counts from Task Service:', error);
    }

    try {
      if (messagingServiceUrl) {
        const chatsRes = await axios.get(`${messagingServiceUrl}/api/v1/chats`, {
          headers: {
            'X-Service-Auth': serviceAuthToken,
            'X-User-Id': userId,
            'X-Service-Name': 'extrahand-user-service'
          }
        }).catch(() => ({ data: [] }));

        chatsCount = Array.isArray(chatsRes.data?.chats || chatsRes.data) ? (chatsRes.data?.chats || chatsRes.data).length : 0;
      }
    } catch (error) {
      logger.warn('Failed to fetch chats from Messaging Service:', error);
    }

    const dashboard = {
      dataCategories: {
        profile: {
          exists: !!profile,
          lastUpdated: profile?.updatedAt,
          fields: profile ? Object.keys(profile).length : 0,
          dataRetentionExpiry: profile?.dataPrivacy?.dataRetentionExpiry,
          lastExported: profile?.dataPrivacy?.lastDataExport
        },
        tasks: {
          count: tasksCount,
          description: 'Tasks you have posted'
        },
        applications: {
          count: applicationsCount,
          description: 'Your applications to tasks'
        },
        chats: {
          count: chatsCount,
          description: 'Chat conversations'
        },
        reviews: {
          count: reviewsCount,
          description: 'Reviews given/received'
        }
      },
      consent: consent ? {
        activeConsents: (consent as any).getActiveConsents ? (consent as any).getActiveConsents() : [],
        consentHistory: consent.consentHistory?.length || 0,
        lastUpdated: consent.updatedAt,
        agreements: {
          termsOfService: consent.agreements?.termsOfService?.acceptedAt,
          privacyPolicy: consent.agreements?.privacyPolicy?.acceptedAt
        }
      } : null,
      rights: {
        dataExport: {
          available: true,
          description: 'Download all your data',
          endpoint: '/api/v1/privacy/data-export'
        },
        deleteAccount: {
          available: true,
          immediate: true,
          description: 'Delete account and all associated work data immediately',
          endpoint: '/api/v1/privacy/delete-account'
        },
        updateConsent: {
          available: true,
          description: 'Update consent preferences',
          endpoint: '/api/v1/privacy/consent'
        }
      },
      deletionStatus: profile?.dataPrivacy?.deletionRequested ? {
        requested: true,
        requestedAt: profile.dataPrivacy.deletionRequestedAt,
        scheduledFor: profile.dataPrivacy.deletionScheduledFor,
        hoursRemaining: profile.dataPrivacy.deletionScheduledFor
          ? Math.max(0, Math.ceil((new Date(profile.dataPrivacy.deletionScheduledFor).getTime() - new Date().getTime()) / (1000 * 60 * 60)))
          : null,
        secondsRemaining: profile.dataPrivacy.deletionScheduledFor
          ? Math.max(0, Math.ceil((new Date(profile.dataPrivacy.deletionScheduledFor).getTime() - new Date().getTime()) / 1000))
          : null
      } : {
        requested: false,
        accountDeleted: profile?.dataPrivacy?.accountDeleted || false,
        accountDeletedAt: profile?.dataPrivacy?.accountDeletedAt || null
      }
    };

    return dashboard;
  }

  /**
   * Get count of open tasks posted by user
   */
  static async getOpenTasksCount(
    userId: string,
    taskServiceUrl: string,
    serviceAuthToken: string
  ): Promise<number> {
    if (!taskServiceUrl) {
      return 0;
    }

    const profile = await Profile.findOne({ uid: userId }).select('_id uid').lean();
    const profileId = profile?._id?.toString();
    if (!profileId) {
      logger.warn('Open tasks count requested but profile not found', { userId });
      return 0;
    }

    try {
      const response = await axios.get(`${taskServiceUrl}/api/v1/tasks/count/open`, {
        params: {
          requesterId: profileId
        },
        headers: {
          'X-Service-Auth': serviceAuthToken,
          'X-User-Id': userId,
          'X-Profile-Id': profileId,
          'X-Service-Name': 'extrahand-user-service'
        },
        timeout: 2500
      });

      const payload = response.data || {};
      const count = Number(payload?.openTasksCount);
      return Number.isFinite(count) && count >= 0 ? count : 0;
    } catch (error) {
      logger.warn('Failed to fetch open tasks count from Task Service:', error);
      throw new ServiceUnavailableError('Unable to fetch open tasks count right now. Please try again shortly.');
    }
  }

  /**
   * Preview task/application counts and active blockers for account deletion UI.
   */
  static async getAccountDeletionPreview(userId: string): Promise<{
    hasActiveBlockers: boolean;
    openTasksCount: number;
    completedTasksCount: number;
    cancelledTasksCount: number;
    applicationsCount: number;
    asPosterActiveCount: number;
    asAssigneeActiveCount: number;
  }> {
    const taskServiceUrl = env.TASK_SERVICE_URL;
    if (!taskServiceUrl || !env.SERVICE_AUTH_TOKEN) {
      throw new ServiceUnavailableError(
        'Unable to load deletion preview right now. Please try again shortly.',
      );
    }

    const profile = await Profile.findOne({ uid: userId }).select('_id uid').lean();
    const profileId = profile?._id?.toString();
    if (!profileId) {
      throw new NotFoundError('Profile not found');
    }

    try {
      const response = await axios.get(
        `${taskServiceUrl}/api/v1/cascade-delete/user/${userId}/account-deletion-preview`,
        {
          headers: this.buildServiceHeaders(userId, profileId),
          timeout: 10000,
        },
      );

      const payload = response.data?.data || response.data || {};
      const num = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      };

      return {
        hasActiveBlockers: Boolean(payload.hasActiveBlockers),
        openTasksCount: num(payload.openTasksCount),
        completedTasksCount: num(payload.completedTasksCount),
        cancelledTasksCount: num(payload.cancelledTasksCount),
        applicationsCount: num(payload.applicationsCount),
        asPosterActiveCount: num(payload.asPosterActiveCount),
        asAssigneeActiveCount: num(payload.asAssigneeActiveCount),
      };
    } catch (error: any) {
      logger.error('Failed to fetch account deletion preview from Task Service', {
        userId,
        profileId,
        statusCode: error?.response?.status,
        responseData: error?.response?.data,
        error: error.message,
      });
      throw new ServiceUnavailableError(
        'Unable to load deletion preview right now. Please try again shortly.',
      );
    }
  }

  /**
   * Update consent
   */
  static async updateConsent(
    userId: string,
    consentType: string,
    value: boolean,
    ipAddress: string,
    userAgent: string,
    reason?: string
  ): Promise<IConsent> {
    if (!consentType || typeof value !== 'boolean') {
      throw new BadRequestError('consentType and value (boolean) are required');
    }

    logger.info('🔐 Consent update requested', { userId, consentType, value });

    let consent = await Consent.findOne({ userId });

    if (!consent) {
      consent = await (Consent as any).createDefaultConsent(userId, ipAddress, userAgent);
    }

    await (consent as any).updateConsent(consentType, value, ipAddress, userAgent, reason);

    logger.info('✅ Consent updated', { userId, consentType, value });

    return consent as unknown as IConsent;
  }

  /**
   * Get consent
   */
  static async getConsent(userId: string, ipAddress: string, userAgent: string): Promise<any> {
    let consent = await Consent.findOne({ userId });

    if (!consent) {
      consent = await (Consent as any).createDefaultConsent(userId, ipAddress, userAgent);
    }

    if (!consent) {
      throw new NotFoundError('Consent record not found');
    }

    return {
      consents: consent.consents,
      agreements: consent.agreements,
      activeConsents: (consent as any).getActiveConsents ? (consent as any).getActiveConsents() : [],
      communicationPreferences: consent.communicationPreferences
    };
  }

  /**
   * Request account deletion — immediate: remove eligible task data, anonymize profile, remove Firebase auth.
   * Blocked when the user has ongoing/assigned tasks.
   */
  static async requestAccountDeletion(
    userId: string,
    reason?: string,
  ): Promise<{ deletedAt: Date; cascadeDeleteResult: Record<string, number> }> {
    logger.info('🗑️ Account deletion request started', {
      userId,
      hasReason: Boolean(reason && reason.trim()),
    });

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    if (profile.dataPrivacy?.accountDeleted) {
      throw new BadRequestError('This account is already deleted');
    }

    await this.assertNoActiveDeletionBlockers(profile);
    const cascadeDeleteResult = await this.cascadeDeleteAccountEligibleData(profile);
    const anonymizedName = await this.anonymizeAccountProfile(profile, reason);
    await this.recordDeletionConsent(userId, reason);
    await this.deleteFirebaseAuthUser(userId);

    const deletedAt = new Date();

    logger.warn('✅ Account deleted immediately', {
      userId,
      anonymizedName,
      cascadeDeleteResult,
      deletedAt,
    });

    return { deletedAt, cascadeDeleteResult };
  }

  /**
   * Cancel account deletion
   */
  static async cancelAccountDeletion(userId: string, ipAddress: string, userAgent: string): Promise<void> {
    const profile = await Profile.findOne({ uid: userId });

    if (profile?.dataPrivacy?.accountDeleted) {
      throw new BadRequestError('This account is already deleted');
    }

    if (!profile || !profile.dataPrivacy?.deletionRequested) {
      throw new BadRequestError('There is no pending deletion request for this account');
    }

    await Profile.updateOne(
      { uid: userId },
      {
        $set: {
          'dataPrivacy.deletionRequested': false,
          'dataPrivacy.deletionRequestedAt': null,
          'dataPrivacy.deletionScheduledFor': null
        }
      }
    );

    // Log in consent history
    const consent = await Consent.findOne({ userId });
    if (consent) {
      consent.consentHistory.push({
        consentType: 'account.deletion',
        action: 'withdrawn' as const,
        givenAt: new Date(),
        ipAddress,
        userAgent,
        reason: 'User cancelled deletion request'
      });
      await consent.save();
    }

    logger.info('✅ Account deletion cancelled', { userId });
  }

  /**
   * Find the nearest scheduled account deletion time.
   */
  static async getNextScheduledDeletionTime(): Promise<Date | null> {
    const nextProfile = await Profile.findOne({
      'dataPrivacy.deletionRequested': true,
      'dataPrivacy.deletionScheduledFor': { $type: 'date' }
    })
      .select('dataPrivacy.deletionScheduledFor')
      .sort({ 'dataPrivacy.deletionScheduledFor': 1 })
      .lean();

    const scheduledFor = (nextProfile as { dataPrivacy?: { deletionScheduledFor?: Date } } | null)?.dataPrivacy?.deletionScheduledFor;
    return scheduledFor ? new Date(scheduledFor) : null;
  }

  /**
   * Execute scheduled deletions (Internal/Cron job)
   * Actually delete accounts that have passed the grace period
   */
  static async executeScheduledDeletions(
    _taskServiceUrl: string,
    _messagingServiceUrl: string,
    _serviceAuthToken: string
  ): Promise<any> {
    const now = new Date();

    // Legacy rows: deletion was scheduled before instant-delete rollout.
    const profilesToDelete = await Profile.find({
      'dataPrivacy.deletionRequested': true,
      'dataPrivacy.accountDeleted': { $ne: true },
      'dataPrivacy.deletionScheduledFor': { $lte: now },
    }).lean();

    if (profilesToDelete.length > 0) {
      logger.warn('Executing legacy scheduled deletions', { count: profilesToDelete.length });
    } else {
      logger.debug('No legacy scheduled deletions due');
    }

    const deletionResults = [];

    for (const profile of profilesToDelete) {
      try {
        const userId = profile.uid;

        await this.assertNoActiveDeletionBlockers(profile);
        await this.cascadeDeleteAccountEligibleData(profile);
        const anonymizedName = await this.anonymizeAccountProfile(
          profile,
          'User requested account deletion (DPDP)',
        );
        await this.deleteFirebaseAuthUser(userId);

        deletionResults.push({
          userId,
          status: 'anonymized',
          deletedAt: new Date(),
          replacementName: anonymizedName,
        });

        logger.warn('✅ Account anonymized for DPDP deletion', { userId, replacementName: anonymizedName });

      } catch (error: any) {
        deletionResults.push({
          userId: profile.uid,
          status: 'failed',
          error: error.message,
        });
        logger.error('Failed legacy scheduled deletion', {
          userId: profile.uid,
          error: error.message,
        });
      }
    }

    return {
      deletedCount: deletionResults.filter((r) => r.status === 'deleted').length,
      failedCount: deletionResults.filter((r) => r.status === 'failed').length,
      results: deletionResults,
    };
  }
}


