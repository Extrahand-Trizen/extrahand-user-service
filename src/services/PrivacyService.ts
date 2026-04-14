import Profile from '../models/Profile';
import Consent, { IConsent } from '../models/Consent';
import { NotFoundError, BadRequestError, ServiceUnavailableError } from '../errors/AppError';
import logger from '../config/logger';
import axios from 'axios';
import { validateEnv } from '../config/env';

const env = validateEnv();
const MIN_DELETION_GRACE_HOURS = 24;
const MAX_DELETION_GRACE_HOURS = 48;
const DEFAULT_DELETION_GRACE_HOURS = 48;

export class PrivacyService {
  private static getDeletionGraceHours(): number {
    const raw = Number(process.env.ACCOUNT_DELETION_GRACE_HOURS || DEFAULT_DELETION_GRACE_HOURS);
    if (!Number.isFinite(raw)) {
      return DEFAULT_DELETION_GRACE_HOURS;
    }
    return Math.min(MAX_DELETION_GRACE_HOURS, Math.max(MIN_DELETION_GRACE_HOURS, Math.floor(raw)));
  }

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

  private static extractTasks(response: any): any[] {
    return response?.data?.tasks || response?.data?.data || response?.tasks || response?.data || [];
  }

  private static async fetchPostedTasksByStatus(profile: any, status: string): Promise<any[]> {
    const taskServiceUrl = env.TASK_SERVICE_URL;
    if (!taskServiceUrl) {
      return [];
    }

    const profileId = profile?._id?.toString();
    const tasks: any[] = [];
    const pageSize = 50;
    let page = 1;

    while (true) {
      const response = await axios.get(`${taskServiceUrl}/api/v1/tasks`, {
        params: {
          posterUid: profile.uid,
          status,
          limit: pageSize,
          page
        },
        headers: this.buildServiceHeaders(profile.uid, profileId),
        timeout: 7000
      });

      const batch = this.extractTasks(response);
      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      tasks.push(...batch);

      if (batch.length < pageSize) {
        break;
      }

      page += 1;
    }

    return tasks;
  }

  private static async deleteOpenPostedTasks(profile: any): Promise<number> {
    const taskServiceUrl = env.TASK_SERVICE_URL;
    if (!taskServiceUrl) {
      return 0;
    }

    const profileId = profile?._id?.toString();
    const openTasks = await this.fetchPostedTasksByStatus(profile, 'open');

    logger.info('Open task cleanup check completed', {
      userId: profile.uid,
      openTasksCount: openTasks.length
    });

    if (openTasks.length === 0) {
      return 0;
    }

    logger.info('Deleting open posted tasks before account deletion', {
      userId: profile.uid,
      taskIds: openTasks.map((task: any) => String(task._id || task.id)).filter(Boolean)
    });

    for (const task of openTasks) {
      const taskId = String(task._id || task.id);

      try {
        await axios.delete(`${taskServiceUrl}/api/v1/tasks/${taskId}`, {
          headers: this.buildServiceHeaders(profile.uid, profileId),
          timeout: 7000
        });
      } catch (error: any) {
        logger.error('Failed to delete open task before account deletion', {
          userId: profile.uid,
          taskId,
          statusCode: error?.response?.status,
          responseData: error?.response?.data,
          error: error.message
        });

        throw new ServiceUnavailableError('Unable to delete your open tasks right now. Please try again shortly.');
      }
    }

    logger.info('Open posted tasks deleted successfully', {
      userId: profile.uid,
      deletedTaskCount: openTasks.length
    });

    return openTasks.length;
  }

  private static async assertNoActiveDeletionBlockers(profile: any): Promise<void> {
    const blockers: string[] = [];
    const taskServiceUrl = env.TASK_SERVICE_URL;
    const profileId = profile?._id?.toString();

    logger.info('🔎 Running deletion blocker checks', {
      userId: profile?.uid,
      profileId,
      hasTaskServiceUrl: Boolean(taskServiceUrl)
    });

    if (!env.SERVICE_AUTH_TOKEN) {
      logger.error('Deletion blocker checks unavailable: SERVICE_AUTH_TOKEN missing', {
        userId: profile?.uid
      });
      throw new ServiceUnavailableError('Account deletion checks are temporarily unavailable. Please try again shortly.');
    }

    try {
      if (taskServiceUrl) {
        const statuses = 'assigned,started,in_progress,review';
        logger.debug('Checking active tasks/applications before deletion', {
          userId: profile.uid,
          profileId,
          statuses
        });
        const [asPoster, asTasker] = await Promise.all([
          axios.get(`${taskServiceUrl}/api/v1/tasks`, {
            params: { posterUid: profile.uid, status: statuses, limit: 1 },
            headers: this.buildServiceHeaders(profile.uid, profileId),
            timeout: 7000
          }),
          axios.get(`${taskServiceUrl}/api/v1/tasks`, {
            params: { assigneeId: profile._id?.toString(), status: statuses, limit: 1 },
            headers: this.buildServiceHeaders(profile.uid, profileId),
            timeout: 7000
          })
        ]);

        const acceptedApplicationsRes = await axios.get(`${taskServiceUrl}/api/v1/applications`, {
          params: { mine: true, status: 'accepted', limit: 1 },
          headers: this.buildServiceHeaders(profile.uid, profileId),
          timeout: 7000
        });

        const posterTasks = asPoster.data?.tasks || asPoster.data?.data || [];
        const taskerTasks = asTasker.data?.tasks || asTasker.data?.data || [];
        const acceptedApplications = acceptedApplicationsRes.data?.applications || acceptedApplicationsRes.data?.data || [];

        logger.info('Task/application blocker check completed', {
          userId: profile.uid,
          posterTasksCount: Array.isArray(posterTasks) ? posterTasks.length : 0,
          taskerTasksCount: Array.isArray(taskerTasks) ? taskerTasks.length : 0,
          acceptedApplicationsCount: Array.isArray(acceptedApplications) ? acceptedApplications.length : 0
        });

        if (
          (Array.isArray(posterTasks) && posterTasks.length > 0) ||
          (Array.isArray(taskerTasks) && taskerTasks.length > 0) ||
          (Array.isArray(acceptedApplications) && acceptedApplications.length > 0)
        ) {
          blockers.push('active tasks (accepted/ongoing)');
        }
      }
    } catch (error: any) {
      logger.error('Failed to validate active tasks before account deletion', {
        userId: profile.uid,
        error: error.message
      });
      throw new ServiceUnavailableError('Unable to verify active tasks right now. Please try again shortly.');
    }

    if (blockers.length > 0) {
      logger.warn('Deletion blocked due to active dependencies', {
        userId: profile.uid,
        blockers
      });
      throw new BadRequestError(
        `Account cannot be deleted while you have ${blockers.join(' and ')}. Complete or cancel your active tasks first.`
      );
    }

    logger.info('Deletion blocker checks passed', {
      userId: profile.uid
    });
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
          gracePeriod: `${this.getDeletionGraceHours()} hours`,
          description: 'Request account deletion',
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
   * Request account deletion
   */
  static async requestAccountDeletion(userId: string, reason?: string): Promise<Date> {
    logger.info('🗑️ Account deletion request started', {
      userId,
      hasReason: Boolean(reason && reason.trim())
    });

    const profile = await Profile.findOne({ uid: userId });

    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    if (profile.dataPrivacy?.accountDeleted) {
      throw new BadRequestError('This account is already deleted');
    }

    if (profile.dataPrivacy?.deletionRequested) {
      throw new BadRequestError('Account deletion has already been requested');
    }

    const deletedOpenTaskCount = await this.deleteOpenPostedTasks(profile);

    await this.assertNoActiveDeletionBlockers(profile);

    // Schedule deletion for 24-48 hours from now (default 48h)
    const graceHours = this.getDeletionGraceHours();
    const deletionDate = new Date();
    deletionDate.setHours(deletionDate.getHours() + graceHours);

    await Profile.updateOne(
      { uid: userId },
      {
        $set: {
          'dataPrivacy.deletionRequested': true,
          'dataPrivacy.deletionRequestedAt': new Date(),
          'dataPrivacy.deletionScheduledFor': deletionDate
        }
      }
    );

    // Log in consent history
    const consent = await Consent.findOne({ userId });
    if (consent) {
      consent.consentHistory.push({
        consentType: 'account.deletion',
        action: 'given' as const,
        givenAt: new Date(),
        ipAddress: 'system',
        userAgent: 'system',
        reason: reason || 'User requested account deletion'
      });
      await consent.save();
    }

    logger.warn('⚠️ Account deletion scheduled', {
      userId,
      scheduledFor: deletionDate,
      graceHours,
      deletedOpenTaskCount
    });

    return deletionDate;
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
   * Execute scheduled deletions (Internal/Cron job)
   * Actually delete accounts that have passed the grace period
   */
  static async executeScheduledDeletions(
    _taskServiceUrl: string,
    _messagingServiceUrl: string,
    _serviceAuthToken: string
  ): Promise<any> {
    const now = new Date();
    
    // Find profiles scheduled for deletion
    const profilesToDelete = await Profile.find({
      'dataPrivacy.deletionRequested': true,
      'dataPrivacy.deletionScheduledFor': { $lte: now }
    }).lean();

    logger.warn('🗑️ Executing scheduled deletions', { 
      count: profilesToDelete.length 
    });

    const deletionResults = [];

    for (const profile of profilesToDelete) {
      try {
        const userId = profile.uid;
        const anonymizedName = this.getDeletionAlias(profile);

        // DPDP-compliant deletion: anonymize personal data, retain legal/audit records.
        await Promise.all([
          Profile.updateOne(
            { uid: userId },
            {
              $set: {
                name: anonymizedName,
                profession: null,
                email: null,
                phone: null,
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
                'dataPrivacy.accountDeletionReason': 'User requested account deletion (DPDP)'
              }
            }
          ),
          Consent.deleteOne({ userId })
        ]);

        deletionResults.push({
          userId,
          status: 'anonymized',
          deletedAt: new Date(),
          replacementName: anonymizedName
        });

        logger.warn('✅ Account anonymized for DPDP deletion', { userId, replacementName: anonymizedName });

      } catch (error: any) {
        deletionResults.push({
          userId: profile.uid,
          status: 'failed',
          error: error.message
        });
        logger.error('❌ Failed to delete account', {
          userId: profile.uid,
          error: error.message
        });
      }
    }

    return {
      deletedCount: deletionResults.filter(r => r.status === 'anonymized').length,
      failedCount: deletionResults.filter(r => r.status === 'failed').length,
      results: deletionResults
    };
  }
}


