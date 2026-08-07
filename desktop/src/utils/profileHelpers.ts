import { UserProfile } from '../types';
import { User } from 'firebase/auth';

/**
 * Resolves the display name of a user from their profile document, falling back
 * to the Firebase User credentials display name or email split if the stored value
 * is empty or matches a placeholder ("Guest", "Guest Unshackler").
 */
export function resolveDisplayName(profile?: UserProfile | null, user?: User | null): string {
  if (!profile) {
    return user?.displayName || user?.email?.split('@')[0] || 'Guest';
  }
  const name = profile.displayName;
  const isPlaceholder = !name || name === 'Guest' || name === 'Guest Unshackler';
  if (!isPlaceholder) {
    return name;
  }
  return user?.displayName || user?.email?.split('@')[0] || 'Guest';
}
