/**
 * Utility functions for skill-related operations
 */

export type ExperienceLevel = 'beginner' | 'intermediate' | 'expert';

/**
 * Derives experience level from years of experience
 * @param yearsOfExperience - Number of years of experience (optional)
 * @returns Experience level based on years
 */
export function getExperienceLevel(yearsOfExperience?: number): ExperienceLevel {
  if (!yearsOfExperience || yearsOfExperience < 0) {
    return 'beginner';
  }
  
  if (yearsOfExperience < 2) {
    return 'beginner';
  }
  
  if (yearsOfExperience < 5) {
    return 'intermediate';
  }
  
  return 'expert';
}

/**
 * Gets a human-readable label for experience level
 * @param level - Experience level
 * @returns Human-readable label
 */
export function getExperienceLevelLabel(level: ExperienceLevel): string {
  const labels: Record<ExperienceLevel, string> = {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    expert: 'Expert'
  };
  
  return labels[level];
}

/**
 * Gets experience level from years with label
 * @param yearsOfExperience - Number of years of experience (optional)
 * @returns Object with level and label
 */
export function getExperienceLevelWithLabel(yearsOfExperience?: number): {
  level: ExperienceLevel;
  label: string;
} {
  const level = getExperienceLevel(yearsOfExperience);
  return {
    level,
    label: getExperienceLevelLabel(level)
  };
}



