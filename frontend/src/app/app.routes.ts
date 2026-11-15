import { Routes } from '@angular/router';
import { loginGuard, roleGuard } from './core/role.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'applicant',
    canActivate: [roleGuard],
    data: { roles: ['Applicant'] },
    loadComponent: () => import('./features/applicant/applicant.component').then((m) => m.ApplicantComponent),
  },
  {
    path: 'reviewer',
    canActivate: [roleGuard],
    data: { roles: ['Reviewer'] },
    loadComponent: () => import('./features/reviewer/reviewer.component').then((m) => m.ReviewerComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  { path: '**', redirectTo: 'login' },
];
