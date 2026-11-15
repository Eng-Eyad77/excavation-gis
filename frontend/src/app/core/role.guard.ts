import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

/**
 * Functional route guard: route data { roles: ['Reviewer'] }.
 * Not logged in -> /login. Wrong role -> that user's own home page.
 * (UX only: the API enforces the same roles with [Authorize(Roles = ...)].)
 */
export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) return router.createUrlTree(['/login']);

  const roles = (route.data['roles'] as Role[] | undefined) ?? [];
  if (roles.length === 0 || auth.hasRole(...roles)) return true;
  return router.createUrlTree([auth.homeFor(auth.role())]);
};

/** Login page: already logged in -> go home. */
export const loginGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree([auth.homeFor(auth.role())]) : true;
};
