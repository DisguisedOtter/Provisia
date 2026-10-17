import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';

type ValidationDetail = { path: string; message: string };

function isValidationDetails(d: unknown): d is ValidationDetail[] {
  return Array.isArray(d) && d.every((x) => x && typeof x === 'object' && 'path' in x);
}

/**
 * Maps the API error envelope onto react-hook-form. `validation_error` details
 * (`[{ path: 'address.city', message }]`) become field errors; everything else is a toast.
 * Returns true when at least one field error was set.
 */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError?: UseFormSetError<T>,
  fallback = 'Something went wrong',
): boolean {
  if (err instanceof ApiError) {
    if (err.code === 'validation_error' && isValidationDetails(err.details) && setError) {
      let applied = false;
      for (const d of err.details) {
        if (d.path) {
          setError(d.path as Path<T>, { type: 'server', message: d.message });
          applied = true;
        }
      }
      if (applied) {
        toast.error('Please correct the highlighted fields');
        return true;
      }
    }
    toast.error(err.message || fallback);
    return false;
  }
  toast.error(err instanceof Error ? err.message : fallback);
  return false;
}

/** True when the endpoint is not implemented yet (404 route-level) so the page can show a soft empty state. */
export function isMissingEndpoint(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404 && /^Route /.test(err.message);
}

export function errorMessage(err: unknown, fallback = 'Something went wrong') {
  if (err instanceof ApiError) return err.message || fallback;
  return err instanceof Error ? err.message : fallback;
}
