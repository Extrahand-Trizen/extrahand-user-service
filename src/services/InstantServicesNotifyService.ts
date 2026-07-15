import {
  InstantServicesNotify,
  InstantServicesNotifyStatus,
} from '../models/InstantServicesNotify';

export class InstantServicesNotifyService {
  static async createNotifyRequest(uid: string): Promise<{
    request: {
      userId: string;
      status: InstantServicesNotifyStatus;
      createdAt: Date;
      notifiedAt: Date | null;
    };
    created: boolean;
  }> {
    const existing = await InstantServicesNotify.findOne({
      userId: uid,
      status: 'active',
    }).lean();

    if (existing) {
      return {
        request: {
          userId: existing.userId,
          status: existing.status,
          createdAt: existing.createdAt,
          notifiedAt: existing.notifiedAt,
        },
        created: false,
      };
    }

    try {
      const request = await InstantServicesNotify.create({
        userId: uid,
        status: 'active',
        notifiedAt: null,
      });

      return {
        request: {
          userId: request.userId,
          status: request.status,
          createdAt: request.createdAt,
          notifiedAt: request.notifiedAt,
        },
        created: true,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicate = await InstantServicesNotify.findOne({
          userId: uid,
          status: 'active',
        }).lean();
        if (duplicate) {
          return {
            request: {
              userId: duplicate.userId,
              status: duplicate.status,
              createdAt: duplicate.createdAt,
              notifiedAt: duplicate.notifiedAt,
            },
            created: false,
          };
        }
      }
      throw error;
    }
  }

  static async getNotifyRequestStatus(uid: string): Promise<{
    hasActiveRequest: boolean;
    status: InstantServicesNotifyStatus | null;
  }> {
    const request = await InstantServicesNotify.findOne({
      userId: uid,
      status: 'active',
    })
      .select('status')
      .lean();

    return {
      hasActiveRequest: Boolean(request),
      status: (request?.status as InstantServicesNotifyStatus) || null,
    };
  }
}
