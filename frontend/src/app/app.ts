import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    @if (auth.user(); as user) {
      <header class="topbar">
        <div class="brand">
          <span class="logo">⛏</span>
          <span>تنسيق أعمال الحفريات · جدة</span>
        </div>
        <div class="who">
          <span>{{ user.username }}</span>
          <span class="role">{{ user.role === 'Reviewer' ? 'مراجع' : 'مقدّم طلب' }}</span>
          @if (user.agencyName) { <span class="muted">{{ user.agencyName }}</span> }
          <button class="btn ghost" (click)="auth.logout()">خروج</button>
        </div>
      </header>
    }
    <router-outlet />
  `,
})
export class App {
  protected readonly auth = inject(AuthService);
}
