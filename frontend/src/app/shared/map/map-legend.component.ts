import { Component, computed, input, signal } from '@angular/core';

export type LegendMode = 'applicant' | 'reviewer';

/** How a legend swatch is drawn (CSS only; colours match symbols.ts and map.component.ts). */
interface LegendItem {
  kind: 'line' | 'dash' | 'fill' | 'dot' | 'halo';
  color: string;
  /** Outline colour for fills / dots */
  stroke?: string;
  /** Line thickness in px */
  size?: number;
  label: string;
  hint?: string;
}

interface LegendGroup {
  title: string;
  items: LegendItem[];
}

const STATUS_GROUP: LegendGroup = {
  title: 'طلبات الحفر المسجّلة (لون الخط = الحالة)',
  items: [
    { kind: 'line', color: '#2563eb', size: 5, label: 'قيد المراجعة' },
    { kind: 'line', color: '#16a34a', size: 5, label: 'معتمد' },
    { kind: 'dash', color: '#787878', size: 4, label: 'مرفوض' },
  ],
};

const APPLICANT_GROUP: LegendGroup = {
  title: 'طلبك الحالي',
  items: [
    { kind: 'line', color: '#eab308', size: 4, label: 'مسار الحفر الذي ترسمه' },
    { kind: 'fill', color: 'rgba(234,179,8,.15)', stroke: '#a16207', label: 'معاينة منطقة الحفر' },
    { kind: 'fill', color: 'rgba(29,106,143,.35)', stroke: '#0f3d5e', label: 'منطقة الحفر بعد التحليل' },
    { kind: 'fill', color: 'rgba(220,38,38,.6)', stroke: '#dc2626', label: 'منطقة التعارض', hint: 'تتداخل مع طلب آخر في نفس الفترة' },
  ],
};

const REVIEWER_GROUP: LegendGroup = {
  title: 'الطلب المفتوح للمراجعة',
  items: [
    { kind: 'halo', color: 'rgba(6,182,212,.6)', size: 12, label: 'الطلب المحدد', hint: 'هالة سماوية تحت خط الطلب' },
    { kind: 'fill', color: 'rgba(29,106,143,.35)', stroke: '#0f3d5e', label: 'منطقة الحفر' },
    { kind: 'fill', color: 'rgba(220,38,38,.6)', stroke: '#dc2626', label: 'منطقة تعارض' },
    { kind: 'fill', color: 'rgba(185,28,28,.9)', stroke: '#b91c1c', label: 'التعارض الذي اخترته من القائمة' },
  ],
};

const CONTEXT_GROUP: LegendGroup = {
  title: 'طبقات مرجعية',
  items: [
    { kind: 'line', color: 'rgba(234,88,12,.55)', size: 10, label: 'طريق سُفلت خلال 12 شهراً', hint: 'محمي: يظهر تحذير لو مرّ فيه الحفر' },
    { kind: 'line', color: 'rgba(100,100,100,.4)', size: 7, label: 'طريق سفلتته قديمة' },
    { kind: 'dot', color: '#2563eb', stroke: '#fff', label: 'مدرسة' },
    { kind: 'dot', color: '#dc2626', stroke: '#fff', label: 'مستشفى', hint: 'المواقع الحساسة: تحذير لو كانت ضمن 50 م من المسار' },
    { kind: 'dash', color: 'rgba(124,58,237,.9)', size: 2, label: 'حدود محافظة جدة', hint: 'يجب أن يكون المسار داخلها' },
  ],
};

/**
 * Always-visible map key, so every colour, line and point can be read without clicking.
 * Collapsible; starts collapsed on narrow screens where the side panel covers the map.
 */
@Component({
  selector: 'app-map-legend',
  template: `
    <section class="legend" [class.collapsed]="collapsed()" dir="rtl">
      <button type="button" class="toggle" (click)="collapsed.set(!collapsed())" [attr.aria-expanded]="!collapsed()">
        <span>مفتاح الخريطة</span><span class="chev">{{ collapsed() ? '▴' : '▾' }}</span>
      </button>
      @if (!collapsed()) {
        <div class="body">
          @for (g of groups(); track g.title) {
            <h4>{{ g.title }}</h4>
            <ul>
              @for (it of g.items; track it.label) {
                <li>
                  <span class="sw">
                    @switch (it.kind) {
                      @case ('line') { <i class="ln" [style.background]="it.color" [style.height.px]="it.size"></i> }
                      @case ('halo') { <i class="ln" [style.background]="it.color" [style.height.px]="it.size"><b></b></i> }
                      @case ('dash') { <i class="ds" [style.border-top-color]="it.color" [style.border-top-width.px]="it.size"></i> }
                      @case ('fill') { <i class="fl" [style.background]="it.color" [style.border-color]="it.stroke"></i> }
                      @case ('dot') { <i class="dt" [style.background]="it.color"></i> }
                    }
                  </span>
                  <span class="tx">{{ it.label }}@if (it.hint) {<small>{{ it.hint }}</small>}</span>
                </li>
              }
            </ul>
          }
          <p class="note">الشوارع الصفراء/البرتقالية العريضة والمباني من خريطة الأساس OpenStreetMap، وليست من بيانات النظام.</p>
        </div>
      }
    </section>
  `,
  styles: `
    .legend {
      position: absolute; left: 12px; bottom: 28px; z-index: 6; width: 260px; max-height: calc(100% - 140px);
      display: flex; flex-direction: column; background: rgba(255,255,255,.96); border: 1px solid #e2e8f0;
      border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,.15); font-size: .78rem; overflow: hidden;
    }
    .toggle {
      display: flex; justify-content: space-between; align-items: center; width: 100%; border: 0; cursor: pointer;
      background: #0f3d5e; color: #fff; font: inherit; font-weight: 700; font-size: .85rem; padding: 7px 12px;
    }
    .body { overflow-y: auto; padding: 4px 12px 10px; }
    h4 { margin: 8px 0 4px; font-size: .78rem; color: #0f3d5e; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
    li { display: flex; align-items: flex-start; gap: 8px; line-height: 1.3; }
    .sw { flex: 0 0 34px; height: 16px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
    .ln { display: block; width: 32px; border-radius: 4px; position: relative; }
    .ln b { position: absolute; inset: 50% 0 auto; height: 4px; transform: translateY(-50%); background: #2563eb; border-radius: 2px; }
    .ds { display: block; width: 32px; height: 0; border-top-style: dashed; }
    .fl { display: block; width: 28px; height: 14px; border: 2px solid; border-radius: 3px; }
    .dt { display: block; width: 13px; height: 13px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
    .tx { display: flex; flex-direction: column; }
    small { color: #64748b; font-size: .7rem; }
    .note { margin: 10px 0 0; color: #64748b; font-size: .7rem; border-top: 1px solid #e2e8f0; padding-top: 6px; }
    @media (max-width: 760px) {
      .legend { top: 12px; bottom: auto; left: 56px; width: 230px; max-height: 40%; }
    }
  `,
})
export class MapLegendComponent {
  readonly mode = input<LegendMode>('applicant');

  readonly collapsed = signal(typeof window !== 'undefined' && window.innerWidth < 760);

  readonly groups = computed<LegendGroup[]>(() => [
    this.mode() === 'reviewer' ? REVIEWER_GROUP : APPLICANT_GROUP,
    STATUS_GROUP,
    CONTEXT_GROUP,
  ]);
}
