import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/api.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <main class="login">
      <form class="card" (ngSubmit)="submit()" #f="ngForm">
        <h1>نظام تنسيق أعمال الحفريات</h1>
        <p class="sub">محرّك نظم معلومات جغرافية لكشف التعارضات قبل الاعتماد</p>

        <label>اسم المستخدم
          <input name="username" [(ngModel)]="username" required autocomplete="username" dir="ltr" />
        </label>
        <label>كلمة المرور
          <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password" dir="ltr" />
        </label>

        @if (error()) { <div class="alert error">{{ error() }}</div> }

        <button class="btn primary" type="submit" [disabled]="busy() || f.invalid">
          {{ busy() ? 'جارٍ الدخول…' : 'دخول' }}
        </button>

        <div class="hint">
          <strong>مستخدمو العرض (بيئة التطوير فقط)</strong>
          <ul>
            @for (u of demoUsers; track u.username) {
              <li>
                <button type="button" class="link" (click)="fill(u.username, u.password)">{{ u.username }}</button>
                <span dir="ltr">{{ u.password }}</span> · {{ u.label }}
              </li>
            }
          </ul>
        </div>
      </form>
    </main>
  `,
  styles: `
    .login { min-height: 100vh; display: grid; place-items: center; padding: 16px;
      background: linear-gradient(135deg, #0f3d5e 0%, #1d6a8f 55%, #2f8f83 100%); }
    .card { width: min(420px, 100%); background: #fff; border-radius: 14px; padding: 28px;
      box-shadow: 0 20px 50px rgba(0,0,0,.25); display: flex; flex-direction: column; gap: 14px; }
    h1 { margin: 0; font-size: 1.35rem; color: #0f3d5e; }
    .sub { margin: -6px 0 6px; color: #64748b; font-size: .9rem; }
    label { display: flex; flex-direction: column; gap: 6px; font-weight: 600; font-size: .9rem; }
    .hint { background: #f1f5f9; border-radius: 8px; padding: 10px 12px; font-size: .85rem; color: #334155; }
    .hint ul { margin: 6px 0 0; padding-inline-start: 18px; }
    .hint li { margin: 4px 0; }
    .hint li span { margin-inline: 8px; color: #475569; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  username = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly demoUsers = [
    { username: 'stc', password: 'Stc@12345', label: 'مقدّم طلب: الاتصالات السعودية' },
    { username: 'nwc', password: 'Nwc@12345', label: 'مقدّم طلب: المياه الوطنية' },
    { username: 'reviewer', password: 'Review@12345', label: 'مراجع: الأمانة' },
  ];

  fill(username: string, password: string): void {
    this.username = username;
    this.password = password;
  }

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const user = await this.auth.login(this.username.trim(), this.password);
      await this.router.navigateByUrl(this.auth.homeFor(user.role));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
