import Profile from '../../models/Profile';

const DEFAULT_MULTIPLIER = 0.8;

/**
 * Performer context for task-completion coin math (replaces payment-service Mongo reads).
 */
export class RewardContextService {
  static async getRewardContext(uid: string): Promise<{
    rating: number;
    ratingMultiplier: number;
    skillCertificateBonusPct: number;
  }> {
    const profile = await Profile.findOne({ uid }).lean();
    if (!profile) {
      return { rating: 0, ratingMultiplier: DEFAULT_MULTIPLIER, skillCertificateBonusPct: 0 };
    }

    const rawRating =
      typeof profile.rating === 'number' || typeof profile.rating === 'string'
        ? Number(profile.rating)
        : 0;
    const totalReviews =
      typeof profile.totalReviews === 'number' || typeof profile.totalReviews === 'string'
        ? Number(profile.totalReviews)
        : 0;

    const rating = Number.isFinite(rawRating) ? Math.max(rawRating, 0) : 0;
    let ratingMultiplier = 0;
    if (totalReviews === 0) {
      ratingMultiplier = DEFAULT_MULTIPLIER;
    } else if (rating >= 3.5) {
      ratingMultiplier = Math.min(rating / 5, 1);
    }

    const skillList =
      profile.skills &&
      typeof profile.skills === 'object' &&
      Array.isArray((profile.skills as { list?: unknown[] }).list)
        ? ((profile.skills as { list: Array<Record<string, unknown>> }).list || [])
        : [];

    const hasCertifiedSkill = skillList.some((skill) => {
      const directCertified = Boolean(skill?.certified === true || skill?.verified === true);
      const certificates = Array.isArray(skill?.certificates) ? skill.certificates : [];
      return (
        directCertified ||
        certificates.some((c) => {
          const status = String((c as { status?: unknown })?.status || '').toLowerCase();
          return status === 'verified';
        })
      );
    });

    return {
      rating,
      ratingMultiplier,
      skillCertificateBonusPct: hasCertifiedSkill ? 0.1 : 0,
    };
  }
}
