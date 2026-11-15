import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AppConfig } from './app-config';
import { AuthService } from './auth.service';

/**
 * Adds "Authorization: Bearer <token>" to calls to OUR API only
 * (never leak the token to third-party hosts). Logs out on 401 (expired/invalid token).
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const apiUrl = inject(AppConfig).value.apiUrl;
  const token = auth.token;

  const isApiCall = req.url.startsWith(apiUrl);
  const authReq = isApiCall && token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((err: unknown) => {
      if (isApiCall && err instanceof HttpErrorResponse && err.status === 401 && token) auth.logout();
      return throwError(() => err);
    }),
  );
};
