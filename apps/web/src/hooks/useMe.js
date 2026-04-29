import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/**
 * Returns the current authenticated user (role / sub / name / providerId /
 * impersonated). Used to gate UI: which tabs to show, where to redirect, etc.
 *
 * Refetches whenever the impersonation switcher changes the X-Dev-User
 * header (the switcher invalidates all queries on toggle).
 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    staleTime: 0,
  });
}
