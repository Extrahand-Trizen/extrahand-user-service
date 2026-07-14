import axios from 'axios';
import Profile from '../models/Profile';
import {
  LocationNotifyRequest,
  ILocationNotifyRequest,
  LocationNotifyRequestStatus,
} from '../models/LocationNotifyRequest';
import { ProfileService } from './ProfileService';
import { BadRequestError, NotFoundError } from '../errors/AppError';
import logger from '../config/logger';
import { validateEnv } from '../config/env';
import {
  normalizeCityKey,
  normalizeProfileLocationParts,
  citiesMatch,
  resolveProfileCityForMatching,
  ProfileLocationLike,
} from '../utils/normalizeProfileLocation';
import InAppNotificationClient from '../clients/InAppNotificationClient';

type ResolvedNotifyLocation = {
  city: string;
  locality: string;
  coordinates: [number, number] | null;
  locationKey: string;
};

function buildLocationKey(
  city: string,
  locality: string,
  coordinates: [number, number] | null,
): string {
  const cityKey = normalizeCityKey(city);
  const localityKey = String(locality || '').trim().toLowerCase();
  if (coordinates && coordinates.length === 2) {
    const lng = Number(coordinates[0]).toFixed(3);
    const lat = Number(coordinates[1]).toFixed(3);
    return `${cityKey}|${localityKey}|${lng},${lat}`;
  }
  return `${cityKey}|${localityKey}`;
}

function resolveCoordinates(location?: ProfileLocationLike): [number, number] | null {
  const coords = (location as { coordinates?: unknown })?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function resolveNotifyLocation(location?: ProfileLocationLike): ResolvedNotifyLocation {
  const { city } = normalizeProfileLocationParts(location);
  const locality = String(location?.addressDetails?.area || '').trim();
  const coordinates = resolveCoordinates(location);

  if (!city) {
    throw new BadRequestError(
      'Could not determine your location. Please set your location and try again.',
    );
  }

  return {
    city,
    locality,
    coordinates,
    locationKey: buildLocationKey(city, locality, coordinates),
  };
}

export class LocationNotifyService {
  static async resolveLocationForUser(uid: string): Promise<ResolvedNotifyLocation> {
    const profile = await Profile.findOne({ uid }).select('location').lean();
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }
    return resolveNotifyLocation(profile.location as ProfileLocationLike);
  }

  static async createNotifyRequest(uid: string): Promise<{
    request: {
      userId: string;
      city: string;
      locality: string;
      coordinates: [number, number] | null;
      status: LocationNotifyRequestStatus;
      createdAt: Date;
      notifiedAt: Date | null;
    };
    created: boolean;
  }> {
    const location = await this.resolveLocationForUser(uid);

    const existing = await LocationNotifyRequest.findOne({
      userId: uid,
      locationKey: location.locationKey,
      status: 'active',
    }).lean();

    if (existing) {
      return {
        request: {
          userId: existing.userId,
          city: existing.city,
          locality: existing.locality,
          coordinates: (existing.coordinates as [number, number] | null) ?? null,
          status: existing.status,
          createdAt: existing.createdAt,
          notifiedAt: existing.notifiedAt,
        },
        created: false,
      };
    }

    try {
      const request = await LocationNotifyRequest.create({
        userId: uid,
        city: location.city,
        locality: location.locality,
        coordinates: location.coordinates,
        locationKey: location.locationKey,
        status: 'active',
        notifiedAt: null,
      });

      void this.processSingleRequest(request).catch((error) => {
        logger.warn('Immediate location notify check failed (non-blocking)', {
          uid,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return {
        request: {
          userId: request.userId,
          city: request.city,
          locality: request.locality,
          coordinates: (request.coordinates as [number, number] | null) ?? null,
          status: request.status,
          createdAt: request.createdAt,
          notifiedAt: request.notifiedAt,
        },
        created: true,
      };
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicate = await LocationNotifyRequest.findOne({
          userId: uid,
          locationKey: location.locationKey,
          status: 'active',
        }).lean();
        if (duplicate) {
          return {
            request: {
              userId: duplicate.userId,
              city: duplicate.city,
              locality: duplicate.locality,
              coordinates: (duplicate.coordinates as [number, number] | null) ?? null,
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
    status: LocationNotifyRequestStatus | null;
    city: string | null;
    locality: string | null;
  }> {
    let location: ResolvedNotifyLocation;
    try {
      location = await this.resolveLocationForUser(uid);
    } catch (error) {
      if (error instanceof BadRequestError) {
        return {
          hasActiveRequest: false,
          status: null,
          city: null,
          locality: null,
        };
      }
      throw error;
    }

    const request = await LocationNotifyRequest.findOne({
      userId: uid,
      locationKey: location.locationKey,
      status: 'active',
    })
      .select('status city locality')
      .lean();

    return {
      hasActiveRequest: Boolean(request),
      status: (request?.status as LocationNotifyRequestStatus) || null,
      city: request?.city || null,
      locality: request?.locality || null,
    };
  }

  static async processActiveRequests(limit = 100): Promise<{
    checked: number;
    notified: number;
  }> {
    const activeRequests = await LocationNotifyRequest.find({ status: 'active' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    let notified = 0;
    for (const request of activeRequests) {
      const didNotify = await this.processSingleRequest(request);
      if (didNotify) notified += 1;
    }

    return { checked: activeRequests.length, notified };
  }

  /**
   * When a helper becomes available in a city (location/role update), notify
   * customers who tapped "Notify me" for that city. Once-only via processSingleRequest.
   */
  static async notifyWaitersForHelperCity(city: string): Promise<{
    checked: number;
    notified: number;
  }> {
    const cityKey = normalizeCityKey(city);
    if (!cityKey) {
      return { checked: 0, notified: 0 };
    }

    const activeRequests = await LocationNotifyRequest.find({ status: 'active' })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    let checked = 0;
    let notified = 0;
    for (const request of activeRequests) {
      if (!citiesMatch(request.city, city)) continue;
      checked += 1;
      const didNotify = await this.processSingleRequest(request);
      if (didNotify) notified += 1;
    }

    return { checked, notified };
  }

  /**
   * Fire-and-forget: if profile is an active helper with a city, fulfill waitlist.
   */
  static maybeNotifyWaitersForHelperProfile(profile: {
    roles?: unknown;
    location?: unknown;
    isActive?: boolean;
    dataPrivacy?: { accountDeleted?: boolean };
  }): void {
    void this.notifyWaitersForHelperProfile(profile).catch((error) => {
      logger.warn('Helper-location notify waiters check failed (non-blocking)', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  static async notifyWaitersForHelperProfile(profile: {
    roles?: unknown;
    location?: unknown;
    isActive?: boolean;
    dataPrivacy?: { accountDeleted?: boolean };
  }): Promise<{ checked: number; notified: number }> {
    if (profile?.isActive === false) {
      return { checked: 0, notified: 0 };
    }
    if (profile?.dataPrivacy?.accountDeleted === true) {
      return { checked: 0, notified: 0 };
    }

    const roles = Array.isArray(profile?.roles)
      ? profile.roles.map((r) => String(r || '').toLowerCase())
      : [];
    const isHelper = roles.some((r) =>
      r === 'tasker' || r === 'helper' || r === 'both' || r === 'performer',
    );
    if (!isHelper) {
      return { checked: 0, notified: 0 };
    }

    const city = resolveProfileCityForMatching(profile.location as ProfileLocationLike);
    if (!city) {
      return { checked: 0, notified: 0 };
    }

    return this.notifyWaitersForHelperCity(city);
  }

  private static async processSingleRequest(
    request: Pick<
      ILocationNotifyRequest,
      '_id' | 'userId' | 'city' | 'locality' | 'coordinates' | 'status'
    >,
  ): Promise<boolean> {
    if (request.status !== 'active') return false;

    const coords = Array.isArray(request.coordinates) ? request.coordinates : null;
    const helpers = await ProfileService.getNearbyHelpers({
      city: request.city,
      lat: coords?.[1],
      lng: coords?.[0],
      limit: 1,
      excludeUid: request.userId,
    });

    if (helpers.length === 0) {
      return false;
    }

    const areaLabel = request.locality || request.city;
    const title = 'New helper available in your area';
    const body = `Good news! A helper is now available in ${areaLabel}. You can post work and get help.`;

    const delivered = await this.sendHelpersAvailableNotification({
      userId: request.userId,
      city: request.city,
      locality: request.locality,
      title,
      body,
    });

    if (!delivered) {
      logger.warn('Helpers available but notification delivery failed; keeping request active', {
        userId: request.userId,
        city: request.city,
      });
      return false;
    }

    await LocationNotifyRequest.updateOne(
      { _id: request._id, status: 'active' },
      { $set: { status: 'notified', notifiedAt: new Date() } },
    );

    logger.info('Location notify request fulfilled', {
      userId: request.userId,
      city: request.city,
      locality: request.locality,
    });

    return true;
  }

  private static async sendHelpersAvailableNotification(params: {
    userId: string;
    city: string;
    locality: string;
    title: string;
    body: string;
  }): Promise<boolean> {
    const env = validateEnv();
    const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;

    const payload = {
      userId: params.userId,
      type: 'HELPERS_AVAILABLE_IN_AREA',
      title: params.title,
      body: params.body,
      category: 'system',
      data: {
        city: params.city,
        locality: params.locality,
        screen: 'PosterHome',
      },
    };

    let pushOk = false;
    let inAppOk = false;

    if (notificationServiceUrl && env.SERVICE_AUTH_TOKEN) {
      try {
        await axios.post(`${notificationServiceUrl}/api/v1/notifications/send`, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
            'X-Service-Name': 'user-service',
          },
          timeout: 10000,
        });
        pushOk = true;
      } catch (error: any) {
        logger.error('Failed to send helpers-available push notification', {
          userId: params.userId,
          message: error?.message,
        });
      }
    } else {
      logger.warn('Notification service not configured for helpers-available push');
    }

    try {
      InAppNotificationClient.initialize(notificationServiceUrl || undefined, 'user-service');
      inAppOk = await InAppNotificationClient.send({
        userId: params.userId,
        title: params.title,
        body: params.body,
        type: 'success',
        category: 'system',
        data: payload.data,
      });
    } catch (error: any) {
      logger.warn('Failed to send helpers-available in-app notification', {
        userId: params.userId,
        message: error?.message,
      });
    }

    return pushOk || inAppOk;
  }
}
