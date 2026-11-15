import { DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, NgZone, OnDestroy, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import Graphic from '@arcgis/core/Graphic.js';
import Polyline from '@arcgis/core/geometry/Polyline.js';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import type MapView from '@arcgis/core/views/MapView.js';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel.js';
import { ApiService, errorMessage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { STATUS_LABELS, WORK_TYPES, workTypeLabel } from '../../core/labels';
import { AnalysisResult, AnalyzeRequest, ProblemDetails } from '../../core/models';
import { geoJsonToEsri, polylineToPaths } from '../../gis/geojson-esri';
import {
  LiveMeasurements, loadGeometryOperators, measureRoute, parseUtmText, utmToWgs84Polyline, wgs84PolylineToUtmText,
} from '../../gis/geometry-tools';
import { MapComponent } from '../../shared/map/map.component';
import {
  CLIENT_BUFFER_SYMBOL, OVERLAP_SELECTED_SYMBOL, OVERLAP_SYMBOL, ROUTE_SYMBOL, SERVER_AREA_SYMBOL,
} from '../../shared/map/symbols';

type Tab = 'draw' | 'utm';


/**
 * Applicant: draw a route (Sketch) or enter UTM 37N coordinates, see a live geodesic
 * preview, run the server analysis (Oracle Spatial) and submit the request.
 */
@Component({
  selector: 'app-applicant',
  imports: [MapComponent, FormsModule, DecimalPipe],
  templateUrl: './applicant.component.html',
  styleUrl: './applicant.component.scss',
})
export class ApplicantComponent implements OnDestroy {
  /** Side panel open/closed (closed = the whole map is free to browse). */
  readonly panelOpen = signal(true);

  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly zone = inject(NgZone);
  private readonly map = viewChild.required(MapComponent);

  readonly workTypes = WORK_TYPES;
  readonly statusLabels = STATUS_LABELS;
  readonly workTypeLabel = workTypeLabel;
  readonly tab = signal<Tab>('draw');

  // ---- form (two-way bound with [(ngModel)])
  readonly workType = signal('Fiber cable');
  readonly widthMeters = signal(1.5);
  readonly startDate = signal('');
  readonly endDate = signal('');
  readonly notes = signal('');
  readonly utmText = signal('');
  readonly utmErrors = signal<string[]>([]);

  // ---- route + results
  /** Current route in the view's spatial reference (Web Mercator) */
  readonly route = signal<Polyline | null>(null);
  readonly drawing = signal(false);
  readonly operatorsReady = signal(false);
  readonly live = signal<LiveMeasurements | null>(null);
  readonly analysis = signal<AnalysisResult | null>(null);
  private readonly analyzedKey = signal<string | null>(null);
  readonly selectedConflict = signal<number | null>(null);
  readonly busy = signal<'analyze' | 'submit' | null>(null);
  readonly error = signal<string | null>(null);
  readonly toast = signal<string | null>(null);

  /** The request as it would be sent now (null while incomplete) */
  readonly request = computed<AnalyzeRequest | null>(() => {
    const route = this.route();
    if (!route || !this.startDate() || !this.endDate()) return null;
    return {
      paths: polylineToPaths(route),
      widthMeters: Number(this.widthMeters()),
      startDate: this.startDate(),
      endDate: this.endDate(),
      workType: this.workType(),
      notes: this.notes().trim() || null,
    };
  });
  /** Analysis shown is for exactly the current inputs (anything edited since -> must re-analyze) */
  readonly analysisIsCurrent = computed(() => {
    const req = this.request();
    return req !== null && this.analyzedKey() === JSON.stringify(req);
  });
  readonly canSubmit = computed(() => this.analysisIsCurrent() && !!this.analysis()?.isValid && this.busy() === null);

  private readonly sketchLayer = new GraphicsLayer({ title: 'المسار المرسوم', listMode: 'hide' });
  private sketch?: SketchViewModel;
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Live client-side preview: recompute whenever the route or the width changes.
    effect(() => {
      const route = this.route();
      const width = Number(this.widthMeters());
      if (!this.operatorsReady()) return;
      untracked(() => this.updateLivePreview(route, width));
    });
  }

  ngOnDestroy(): void {
    this.sketch?.destroy();
    clearTimeout(this.toastTimer);
  }

  // ------------------------------------------------------------------ map setup

  async onMapReady(view: MapView): Promise<void> {
    // Route goes UNDER the analysis layers, so the red conflict overlaps stay visible on top of it.
    view.map?.add(this.sketchLayer, view.map.layers.indexOf(this.map().previewLayer));

    this.sketch = new SketchViewModel({
      view,
      layer: this.sketchLayer,
      polylineSymbol: ROUTE_SYMBOL,
      updateOnGraphicClick: true,
      defaultUpdateOptions: { tool: 'reshape', toggleToolOnClick: false },
    });
    // React only to finished operations (state === 'complete'), not every mouse move.
    this.sketch.on('create', (e) => {
      if (e.state === 'complete' && e.graphic) {
        this.zone.run(() => {
          this.drawing.set(false);
          this.keepOnly(e.graphic!);
          this.setRoute(e.graphic!.geometry as Polyline);
        });
      } else if (e.state === 'cancel') {
        this.zone.run(() => this.drawing.set(false));
      }
    });
    this.sketch.on('update', (e) => {
      if (e.state === 'complete' && e.graphics.length) this.zone.run(() => this.setRoute(e.graphics[0].geometry as Polyline));
    });
    this.sketch.on('delete', () => this.zone.run(() => this.clearRoute()));

    await Promise.all([this.loadExcavations(), loadGeometryOperators().then(() => this.operatorsReady.set(true))]);
  }

  private async loadExcavations(): Promise<void> {
    try {
      await this.map().setExcavations(await this.api.excavations());
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }

  // ------------------------------------------------------------------ drawing

  startDrawing(): void {
    this.clearRoute();
    this.drawing.set(true);
    this.sketch?.create('polyline');
  }

  cancelDrawing(): void {
    this.sketch?.cancel();
    this.drawing.set(false);
  }

  clearRoute(): void {
    this.sketch?.cancel();
    this.sketchLayer.removeAll();
    this.route.set(null);
    this.analysis.set(null);
    this.analyzedKey.set(null);
    this.selectedConflict.set(null);
    this.map().previewLayer.removeAll();
    this.map().conflictLayer.removeAll();
  }

  /** One route at a time: remove every other sketch graphic. */
  private keepOnly(graphic: Graphic): void {
    this.sketchLayer.graphics.filter((g) => g !== graphic).forEach((g) => this.sketchLayer.remove(g));
  }

  private setRoute(polyline: Polyline): void {
    this.route.set(polyline.clone());
    this.error.set(null);
    this.map().conflictLayer.removeAll();
    this.selectedConflict.set(null);
  }

  /** Put a WGS84 polyline on the map as the editable route and zoom to it. */
  private showRoute(geographic: Polyline): void {
    this.clearRoute();
    const mercator = webMercatorUtils.geographicToWebMercator(geographic) as Polyline;
    const graphic = new Graphic({ geometry: mercator, symbol: ROUTE_SYMBOL });
    this.sketchLayer.add(graphic);
    this.setRoute(mercator);
    void this.map().goTo(graphic, { duration: 800 });
  }

  private updateLivePreview(route: Polyline | null, width: number): void {
    const preview = this.map().previewLayer;
    preview.removeAll();
    if (!route) {
      this.live.set(null);
      return;
    }
    const m = measureRoute(route, width >= 0.3 && width <= 10 ? width : 0);
    this.live.set(m);
    if (m.bufferPolygon) preview.add(new Graphic({ geometry: m.bufferPolygon, symbol: CLIENT_BUFFER_SYMBOL }));
  }

  // ------------------------------------------------------------------ UTM tab

  applyUtm(): void {
    const { points, errors } = parseUtmText(this.utmText());
    this.utmErrors.set(errors);
    if (errors.length) return;
    try {
      this.showRoute(utmToWgs84Polyline(points));
    } catch {
      this.utmErrors.set(['تعذّر تحويل الإحداثيات من UTM إلى WGS84.']);
    }
  }

  /** Fills the UTM box with the demo route converted WGS84 -> UTM 37N (real OSM vertices). */
  async fillUtmExample(): Promise<void> {
    const demo = await this.fetchDemo();
    if (!demo || !this.operatorsReady()) return;
    const polyline = new Polyline({ paths: demo.paths, spatialReference: { wkid: 4326 } });
    this.utmText.set(wgs84PolylineToUtmText(polyline));
    this.utmErrors.set([]);
  }

  // ------------------------------------------------------------------ demo helper

  /** Loads the reproducible demo request (route from OSM + sample dates). */
  async loadDemo(): Promise<void> {
    const demo = await this.fetchDemo();
    if (!demo) return;
    this.workType.set(demo.workType);
    this.widthMeters.set(demo.widthMeters);
    this.startDate.set(demo.startDate);
    this.endDate.set(demo.endDate);
    this.tab.set('draw');
    this.showRoute(new Polyline({ paths: demo.paths, spatialReference: { wkid: 4326 } }));
  }

  private async fetchDemo(): Promise<AnalyzeRequest | null> {
    try {
      const res = await fetch('demo_route.json');
      return (await res.json()) as AnalyzeRequest;
    } catch {
      this.error.set('تعذّر تحميل مسار العرض.');
      return null;
    }
  }

  // ------------------------------------------------------------------ analyze + submit

  async analyze(): Promise<void> {
    const req = this.request();
    if (!req) {
      this.error.set('ارسم المسار وحدد تاريخ البداية والنهاية أولاً.');
      return;
    }
    this.busy.set('analyze');
    this.error.set(null);
    try {
      const result = await this.api.analyze(req);
      this.analysis.set(result);
      this.analyzedKey.set(JSON.stringify(req));
      this.selectedConflict.set(null);
      this.drawAnalysis(result);
      if (result.conflicts.length) this.selectConflict(0);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }

  async submit(): Promise<void> {
    const req = this.request();
    if (!req || !this.canSubmit()) return;
    this.busy.set('submit');
    this.error.set(null);
    try {
      const res = await this.api.createExcavation(req);
      this.showToast(`تم تقديم الطلب رقم ${res.excavation.id} بنجاح. الحالة: قيد المراجعة.`);
      this.clearRoute();
      this.notes.set('');
      await this.loadExcavations();
    } catch (e) {
      const body = e instanceof HttpErrorResponse ? (e.error as ProblemDetails | null) : null;
      this.error.set(body?.errors?.length ? `${body.title} ${body.errors.join(' ')}` : errorMessage(e));
      if (body?.analysis) this.analysis.set(body.analysis);
    } finally {
      this.busy.set(null);
    }
  }

  /** Server results on the map: Oracle's buffered area (blue) and conflict overlaps (red). */
  private drawAnalysis(result: AnalysisResult): void {
    const preview = this.map().previewLayer;
    if (result.areaGeoJson) preview.add(new Graphic({ geometry: geoJsonToEsri(result.areaGeoJson), symbol: SERVER_AREA_SYMBOL }));
    this.drawOverlaps();
  }

  private drawOverlaps(): void {
    const layer = this.map().conflictLayer;
    layer.removeAll();
    this.analysis()?.conflicts.forEach((c, i) => {
      if (!c.overlapGeoJson) return;
      layer.add(new Graphic({
        geometry: geoJsonToEsri(c.overlapGeoJson),
        symbol: i === this.selectedConflict() ? OVERLAP_SELECTED_SYMBOL : OVERLAP_SYMBOL,
        attributes: { excavationId: c.excavationId },
      }));
    });
  }

  selectConflict(index: number): void {
    this.selectedConflict.set(index);
    this.drawOverlaps();
    const overlap = this.analysis()?.conflicts[index]?.overlapGeoJson;
    if (overlap) void this.map().goTo(geoJsonToEsri(overlap).extent?.clone().expand(2.5) ?? geoJsonToEsri(overlap));
  }

  private showToast(message: string): void {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 6000);
  }
}
