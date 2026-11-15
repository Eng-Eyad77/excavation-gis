import { computed, inject, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from './app-config';
import { LoginResponse, Role } from './models';

const STORAGE_KEY = 'excav.auth';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly config = inject(AppConfig);

  /** Current user (null when logged out). Restored from localStorage on reload. */
  readonly user = signal<LoginResponse | null>(this.restore());
  readonly isLoggedIn = computed(() => this.user() !== null);
  readonly role = computed(() => this.user()?.role ?? null);

  get token(): string | null {
    return this.user()?.token ?? null;
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${this.config.value.apiUrl}/auth/login`, { username, password }),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(res));
    this.user.set(res);
    return res;
  }

  logout(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.user.set(null);
    void this.router.navigate(['/login']);
  }

  hasRole(...roles: Role[]): boolean {
    const r = this.role();
    return r !== null && roles.includes(r);
  }

  homeFor(role: Role | null): string {
    return role === 'Reviewer' ? '/reviewer' : '/applicant';
  }

  private restore(): LoginResponse | null {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      const user = JSON.parse(saved) as LoginResponse;
      return isExpired(user.token) ? null : user;
    } catch {
      return null;
    }
  }
}

/** Reads the JWT "exp" claim (seconds since epoch). The server still validates the signature. */
function isExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
