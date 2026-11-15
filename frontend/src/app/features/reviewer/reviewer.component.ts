import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import Graphic from '@arcgis/core/Graphic.js';
import { ApiService, errorMessage } from '../../core/api.service';
import { STATUS_LABELS, workTypeLabel } from '../../core/labels';
import { Agency, Excavation, ExcavationDetail, ExcavationStatus } from '../../core/models';
import { geoJsonToEsri } from '../../gis/geojson-esri';
import { MapComponent } from '../../shared/map/map.component';
import { OVERLAP_SELECTED_SYMBOL, OVERLAP_SYMBOL, SELECTED_ROUTE_SYMBOL, SERVER_AREA_SYMBOL } from '../../shared/map/symbols';

/**
 * Reviewer (municipality): filter the requests, open one with its CURRENT conflicts
 * (re-computed in Oracle), approve or reject it, and pull sensitive sites from ArcGIS.
 */
@Component({
  selector: 'app-reviewer',
  imports: [MapComponent, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './reviewer.component.html',
  styleUrl: './reviewer.component.scss',
})
export class ReviewerComponent {
  /** Side panel open/closed (closed = the whole map is free to browse). */
  readonly panelOpen = signal(true);

  private readonly api = inject(ApiService);
  private readonly map = viewChild.required(MapComponent);

  readonly statusLabels = STATUS_LABELS;
  readonly workTypeLabel = workTypeLabel;

  // ---- filters + list
  readonly agencies = signal<Agency[]>([]);
  // All statuses by default: after a refresh the reviewer still sees the requests he already
  // approved/rejected (a "Pending" default made them look deleted). Pending ones are counted in the header.
  readonly statusFilter = signal<ExcavationStatus | ''>('');
  readonly agencyFilter = signal<number | null>(null);
  readonly items = signal<Excavation[]>([]);
  readonly loadingList = signal(false);

  // ---- selection
  readonly selectedId = signal<number | null>(null);
  readonly detail = signal<ExcavationDetail | null>(null);
  readonly loadingDetail = signal(false);
  readonly selectedConflict = signal<number | null>(null);
  readonly reviewNote = signal('');
  readonly busy = signal<'approve' | 'reject' | 'sync' | null>(null);

  // ---- messages
  readonly error = signal<string | null>(null);
  readonly info = signal<string | null>(null);
  readonly syncMessage = signal<{ ok: boolean; text: string } | null>(null);

  readonly counts = computed(() => {
    const list = this.items();
    return { total: list.length, pending: list.filter((e) => e.status === 'Pending').length };
  });

  async onMapReady(): Promise<void> {
    // Clicking a request opens the detail panel; the map popup would only duplicate it.
    this.map().excavationsLayer.popupEnabled = false;
    try {
      this.agencies.set(await this.api.agencies());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
    await this.loadList();
  }

  // ------------------------------------------------------------------ list

  async loadList(): Promise<void> {
    this.loadingList.set(true);
    try {
      // Newest first (the API orders by created_at DESC)
      const items = await this.api.excavations({ status: this.statusFilter(), agencyId: this.agencyFilter() });
      this.items.set(items);
      await this.map().setExcavations(items);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loadingList.set(false);
    }
  }

  onFilterChange(): void {
    void this.loadList();
  }

  // ------------------------------------------------------------------ selection

  async select(id: number): Promise<void> {
    this.panelOpen.set(true); // clicking a request on the map re-opens a collapsed panel
    this.selectedId.set(id);
    this.selectedConflict.set(null);
    this.reviewNote.set('');
    this.error.set(null);
    this.info.set(null);
    this.loadingDetail.set(true);
    try {
      const detail = await this.api.excavation(id); // conflicts are re-computed now, excluding this request
      this.detail.set(detail);
      this.drawSelection(detail, true);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.detail.set(null);
    } finally {
      this.loadingDetail.set(false);
    }
  }

  closeDetail(): void {
    this.selectedId.set(null);
    this.detail.set(null);
    this.map().previewLayer.removeAll();
    this.map().conflictLayer.removeAll();
  }

  /** Selected request: halo on the route + Oracle's buffered area; conflict overlaps in red. */
  private drawSelection(detail: ExcavationDetail, zoom: boolean): void {
    const { previewLayer, conflictLayer } = this.map();
    previewLayer.removeAll();
    conflictLayer.removeAll();

    const route = new Graphic({ geometry: geoJsonToEsri(detail.excavation.routeGeoJson), symbol: SELECTED_ROUTE_SYMBOL });
    const area = new Graphic({ geometry: geoJsonToEsri(detail.excavation.areaGeoJson), symbol: SERVER_AREA_SYMBOL });
    previewLayer.addMany([route, area]);

    detail.conflicts.forEach((c, i) => {
      if (!c.overlapGeoJson) return;
      conflictLayer.add(new Graphic({
        geometry: geoJsonToEsri(c.overlapGeoJson),
        symbol: i === this.selectedConflict() ? OVERLAP_SELECTED_SYMBOL : OVERLAP_SYMBOL,
      }));
    });

    if (zoom) void this.map().goTo(route.geometry!.extent!.clone().expand(1.6));
  }

  selectConflict(index: number): void {
    const detail = this.detail();
    if (!detail) return;
    this.selectedConflict.set(index);
    this.drawSelection(detail, false);
    const overlap = detail.conflicts[index]?.overlapGeoJson;
    if (overlap) void this.map().goTo(geoJsonToEsri(overlap).extent!.clone().expand(2.5));
  }

  // ------------------------------------------------------------------ review

  async approve(): Promise<void> {
    await this.review('approve');
  }

  async reject(): Promise<void> {
    if (!this.reviewNote().trim()) {
      this.error.set('سبب الرفض مطلوب.');
      return;
    }
    await this.review('reject');
  }

  private async review(action: 'approve' | 'reject'): Promise<void> {
    const id = this.selectedId();
    if (id === null) return;
    this.busy.set(action);
    this.error.set(null);
    try {
      const note = this.reviewNote().trim();
      const updated = action === 'approve' ? await this.api.approve(id, note || null) : await this.api.reject(id, note);
      this.info.set(`تم ${action === 'approve' ? 'اعتماد' : 'رفض'} الطلب رقم ${updated.id}.`);
      await this.loadList();
      // Keep the reviewed request open (refreshed), even if the status filter now hides it from the list
      const detail = await this.api.excavation(id);
      this.detail.set(detail);
      this.drawSelection(detail, false);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  // ------------------------------------------------------------------ ArcGIS Feature Service sync

  async syncSensitiveSites(): Promise<void> {
    this.busy.set('sync');
    this.syncMessage.set(null);
    try {
      const r = await this.api.syncSensitiveSites();
      this.syncMessage.set({ ok: true, text: `تمت المزامنة: ${r.imported} جديد، ${r.updated} محدّث.` });
    } catch (e) {
      this.syncMessage.set({ ok: false, text: errorMessage(e) });
    } finally {
      this.busy.set(null);
    }
  }
}
