import {
  AfterViewInit, Component, effect, ElementRef, inject, input, NgZone, OnDestroy, output, signal, viewChild,
} from '@angular/core';
import ArcGISMap from '@arcgis/core/Map.js';
import Graphic from '@arcgis/core/Graphic.js';
import MapView from '@arcgis/core/views/MapView.js';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils.js';
import FeatureLayer from '@arcgis/core/layers/FeatureLayer.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import TileLayer from '@arcgis/core/layers/TileLayer.js';
import UniqueValueRenderer from '@arcgis/core/renderers/UniqueValueRenderer.js';
import SimpleRenderer from '@arcgis/core/renderers/SimpleRenderer.js';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol.js';
import Expand from '@arcgis/core/widgets/Expand.js';
import LayerList from '@arcgis/core/widgets/LayerList.js';
import type { GoToOptions2D, GoToTarget2D } from '@arcgis/core/views/types.js';
import { LegendMode, MapLegendComponent } from './map-legend.component';
import { ApiService } from '../../core/api.service';
import { AppConfig } from '../../core/app-config';
import { Excavation } from '../../core/models';
import { geoJsonToEsri } from '../../gis/geojson-esri';

/** Centre of the demo segment (Khalid bin Al-Walid St, from OSM) */
const DEMO_CENTER: [number, number] = [39.1867, 21.5086];

export const STATUS_COLORS = {
  Pending: [37, 99, 235],    // blue
  Approved: [22, 163, 74],   // green
  Rejected: [120, 120, 120], // gray
} as const;

/**
 * Reusable map: Map + MapView created in ngAfterViewInit, destroyed in ngOnDestroy.
 * Layers (bottom -> top):
 *  1. ArcGIS MapServer (World Transportation reference tiles)
 *  2. City boundary  3. Paved roads  4. Sensitive sites (Feature Service or API GeoJSON)
 *  5. Excavations (client-side FeatureLayer + UniqueValueRenderer by status)
 *  6. Current request preview + conflict overlaps (GraphicsLayers)
 */
@Component({
  selector: 'app-map',
  imports: [MapLegendComponent],
  template: `
    <div #mapContainer class="map"></div>
    <app-map-legend [mode]="legend()" />
    @if (loading()) {
      <div class="map-loading"><span class="spinner"></span> جارٍ تحميل الخريطة…</div>
    }
    @if (loadError()) {
      <div class="map-error">{{ loadError() }}</div>
    }
  `,
  styles: `
    :host { display: block; position: relative; height: 100%; width: 100%; }
    .map { position: absolute; inset: 0; }
    .map-loading {
      position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 5;
      background: #fff; border: 1px solid #e2e8f0; border-radius: 999px; padding: 6px 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,.12); font-size: .85rem; display: flex; align-items: center; gap: 8px;
    }
    .spinner {
      width: 14px; height: 14px; border: 2px solid #cbd5e1; border-top-color: #0f4c81; border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .map-error {
      position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 7; max-width: 360px;
      background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px;
    }
  `,
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly config = inject(AppConfig);
  private readonly zone = inject(NgZone);
  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

  /** Width (px) of the side panel that floats over the map, so goTo() centres in the visible part. */
  readonly panelWidth = input(0);
  /** Which role-specific symbols the always-visible legend explains. */
  readonly legend = input<LegendMode>('applicant');

  /** Re-apply the view padding whenever the parent opens/closes its side panel. */
  private readonly panelEffect = effect(() => {
    this.panelWidth();
    this.applyPadding();
  });

  /**
   * view.padding = the part of the map covered by the floating side panel, so the
   * "centre" used by goTo() is the visible part. Panel is on the right on desktop,
   * at the bottom (55% height) on narrow screens: same breakpoint as styles.scss.
   */
  private applyPadding(): void {
    const view = this.view;
    if (!view) return;
    const open = this.panelWidth() > 0;
    view.padding = view.width < 760
      ? { top: 0, left: 0, right: 0, bottom: open ? Math.round(view.height * 0.55) : 0 }
      : { top: 0, left: 0, bottom: 0, right: this.panelWidth() };
  }
  /** Emitted once the view and all layers are ready. */
  readonly ready = output<MapView>();
  /** Emitted when the user clicks an excavation on the map. */
  readonly excavationClick = output<number>();

  readonly loadError = signal<string | null>(null);
  /** True until the view and its layers are ready. */
  readonly loading = signal(true);

  view?: MapView;
  readonly excavationsLayer = new FeatureLayer({
    title: 'طلبات الحفر (حسب الحالة)',
    source: [],
    objectIdField: 'ObjectID',
    geometryType: 'polyline',
    spatialReference: { wkid: 4326 },
    fields: [
      { name: 'ObjectID', type: 'oid' },
      { name: 'excavationId', type: 'integer', alias: 'رقم الطلب' },
      { name: 'status', type: 'string', alias: 'الحالة' },
      { name: 'agencyName', type: 'string', alias: 'الجهة' },
      { name: 'workType', type: 'string', alias: 'نوع العمل' },
      { name: 'startDate', type: 'string', alias: 'من' },
      { name: 'endDate', type: 'string', alias: 'إلى' },
      { name: 'widthMeters', type: 'double', alias: 'العرض (م)' },
    ],
    renderer: new UniqueValueRenderer({
      field: 'status',
      legendOptions: { title: 'حالة الطلب' },
      defaultSymbol: line([0, 0, 0], 4),
      uniqueValueInfos: [
        { value: 'Pending', label: 'قيد المراجعة', symbol: line(STATUS_COLORS.Pending, 5) },
        { value: 'Approved', label: 'معتمد', symbol: line(STATUS_COLORS.Approved, 5) },
        { value: 'Rejected', label: 'مرفوض', symbol: line(STATUS_COLORS.Rejected, 5, 'dash') },
      ],
    }),
    popupTemplate: {
      title: 'طلب حفر رقم {excavationId}',
      content: [{ type: 'fields', fieldInfos: [
        { fieldName: 'agencyName', label: 'الجهة' }, { fieldName: 'workType', label: 'نوع العمل' },
        { fieldName: 'status', label: 'الحالة' }, { fieldName: 'startDate', label: 'من' },
        { fieldName: 'endDate', label: 'إلى' }, { fieldName: 'widthMeters', label: 'العرض (م)' },
      ] }],
    },
  });
  /** Selected/previewed request: route + buffered area */
  readonly previewLayer = new GraphicsLayer({ title: 'الطلب الحالي', listMode: 'hide' });
  /** Red overlap polygons of conflicts */
  readonly conflictLayer = new GraphicsLayer({ title: 'مناطق التعارض', listMode: 'hide' });

  ngAfterViewInit(): void {
    // ArcGIS runs its own render loop; keep it outside Angular change detection.
    this.zone.runOutsideAngular(() => void this.init());
  }

  ngOnDestroy(): void {
    this.view?.destroy(); // releases WebGL context, layer views and event handles
    this.view = undefined;
  }

  private async init(): Promise<void> {
    const map = new ArcGISMap({ basemap: 'osm' }); // OpenStreetMap: matches our OSM-derived data, no API key

    // 1. Map Service (ArcGIS MapServer): cached reference tiles for roads.
    // Hidden by default: its road names come from a different provider (HERE) and are baked
    // into the tiles, so they still show streets Jeddah has since demolished (e.g. Al-Aziziyah)
    // on top of the up-to-date OSM basemap. Turn it on from the layer list to show the Map Service.
    map.add(new TileLayer({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer',
      title: 'شبكة الطرق (ArcGIS) — قد لا تكون محدّثة',
      opacity: 0.6,
      visible: false,
    }));

    this.view = new MapView({
      container: this.container().nativeElement,
      map,
      center: DEMO_CENTER,
      zoom: 15,
      padding: { top: 0, bottom: 0, left: 0, right: this.panelWidth() },
      popup: { dockEnabled: false },
    });

    // panelWidth 0 = panel collapsed: no padding, the whole map is usable.
    const view = this.view;
    view.addHandles(reactiveUtils.watch(
      () => [view.width, view.height],
      () => this.applyPadding(),
      { initial: true },
    ));

    this.view.ui.add(new Expand({ content: new LayerList({ view: this.view }), expandTooltip: 'الطبقات', group: 'top-left' }), 'top-left');

    try {
      const [boundary, paved, sites] = await Promise.all([this.boundaryLayer(), this.pavedRoadsLayer(), this.sensitiveSitesLayer()]);
      map.addMany([boundary, paved, sites, this.excavationsLayer, this.previewLayer, this.conflictLayer]);
    } catch (e) {
      console.error(e);
      this.zone.run(() => this.loadError.set('تعذّر تحميل طبقات الخريطة من الخادم.'));
      map.addMany([this.excavationsLayer, this.previewLayer, this.conflictLayer]);
    }

    // Click near an excavation -> tell the parent (reviewer selects it).
    // A spatial query with a ~8 px tolerance is easier to hit than the 5 px line itself (hitTest).
    this.view.on('click', async (event) => {
      const tolerance = (this.view?.resolution ?? 1) * 8; // map units (metres) per 8 screen pixels
      const result = await this.excavationsLayer.queryFeatures({
        geometry: event.mapPoint,
        distance: tolerance,
        units: 'meters',
        spatialRelationship: 'intersects',
        outFields: ['excavationId'],
        returnGeometry: false,
      });
      const id = result.features[0]?.attributes?.['excavationId'] as number | undefined;
      if (id) this.zone.run(() => this.excavationClick.emit(id));
    });

    try {
      await this.view.when();
    } catch (e) {
      console.error(e);
      this.zone.run(() => this.loadError.set('تعذّر تهيئة الخريطة.'));
    }
    this.zone.run(() => {
      this.loading.set(false);
      this.ready.emit(this.view!);
    });
  }

  // ------------------------------------------------------------------ public API for parent screens

  /** Replace all excavation features (applyEdits on the client-side FeatureLayer). */
  async setExcavations(items: Excavation[]): Promise<void> {
    const graphics = items.map((e) => new Graphic({
      geometry: geoJsonToEsri(e.routeGeoJson),
      attributes: {
        excavationId: e.id, status: e.status, agencyName: e.agencyName, workType: e.workType,
        startDate: e.startDate, endDate: e.endDate, widthMeters: e.widthMeters,
      },
    }));
    const existing = await this.excavationsLayer.queryFeatures();
    await this.excavationsLayer.applyEdits({ deleteFeatures: existing.features, addFeatures: graphics });
  }

  /** view.goTo that ignores AbortError (thrown when a newer goTo interrupts an older one). */
  async goTo(target: GoToTarget2D, options?: GoToOptions2D): Promise<void> {
    try {
      await this.view?.goTo(target, { duration: 800, ...options });
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') console.warn('goTo failed', e);
    }
  }

  // ------------------------------------------------------------------ reference layers

  private async boundaryLayer(): Promise<FeatureLayer> {
    const fc = await this.api.cityBoundary();
    return new FeatureLayer({
      title: 'حدود محافظة جدة (OSM)',
      source: fc.features.map((f) => new Graphic({ geometry: geoJsonToEsri(f.geometry), attributes: { name: f.properties.name } })),
      objectIdField: 'ObjectID',
      geometryType: 'polygon',
      spatialReference: { wkid: 4326 },
      fields: [{ name: 'ObjectID', type: 'oid' }, { name: 'name', type: 'string', alias: 'الاسم' }],
      renderer: new SimpleRenderer({
        symbol: new SimpleFillSymbol({ color: [0, 0, 0, 0], outline: { color: [124, 58, 237, 0.9], width: 2, style: 'dash' } }),
        label: 'حدود المحافظة',
      }),
      popupEnabled: false,
    });
  }

  private async pavedRoadsLayer(): Promise<FeatureLayer> {
    const fc = await this.api.pavedRoads();
    return new FeatureLayer({
      title: 'طرق مسفلتة (تاريخ السفلتة تجريبي)',
      source: fc.features.map((f) => new Graphic({
        geometry: geoJsonToEsri(f.geometry),
        attributes: { name: f.properties.name, pavedDate: f.properties.pavedDate, recent: f.properties.isRecent ? 'yes' : 'no' },
      })),
      objectIdField: 'ObjectID',
      geometryType: 'polyline',
      spatialReference: { wkid: 4326 },
      fields: [
        { name: 'ObjectID', type: 'oid' },
        { name: 'name', type: 'string', alias: 'الطريق' },
        { name: 'pavedDate', type: 'string', alias: 'تاريخ السفلتة' },
        { name: 'recent', type: 'string', alias: 'حديث' },
      ],
      renderer: new UniqueValueRenderer({
        field: 'recent',
        uniqueValueInfos: [
          { value: 'yes', label: 'سُفلت خلال 12 شهراً (محمي)', symbol: line([234, 88, 12, 0.55], 14) },
          { value: 'no', label: 'سفلتة قديمة', symbol: line([100, 100, 100, 0.4], 8) },
        ],
      }),
      popupTemplate: { title: '{name}', content: [{ type: 'fields', fieldInfos: [{ fieldName: 'pavedDate', label: 'تاريخ السفلتة (تجريبي)' }] }] },
    });
  }

  /**
   * Feature Service (hosted layer in ArcGIS Online) when sensitiveSitesLayerUrl is configured,
   * otherwise the same data from our API (Oracle) as a client-side FeatureLayer.
   */
  private async sensitiveSitesLayer(): Promise<FeatureLayer> {
    const renderer = (field: string) => new UniqueValueRenderer({
      field,
      uniqueValueInfos: [
        { value: 'School', label: 'مدرسة', symbol: marker([37, 99, 235]) },
        { value: 'Hospital', label: 'مستشفى', symbol: marker([220, 38, 38]) },
      ],
    });

    const url = this.config.value.sensitiveSitesLayerUrl;
    if (url) {
      return new FeatureLayer({
        url,
        title: 'المواقع الحساسة: مدارس ومستشفيات (ArcGIS)',
        outFields: ['*'],
        renderer: renderer('site_type'),
        popupTemplate: { title: '{name}', content: [{ type: 'fields', fieldInfos: [{ fieldName: 'site_type', label: 'النوع' }, { fieldName: 'external_id', label: 'معرّف OSM' }] }] },
      });
    }

    const fc = await this.api.sensitiveSites();
    return new FeatureLayer({
      title: 'المواقع الحساسة: مدارس ومستشفيات (OSM)',
      source: fc.features.map((f) => new Graphic({
        geometry: geoJsonToEsri(f.geometry),
        attributes: { name: f.properties.name, siteType: f.properties.siteType, externalId: f.properties.externalId, source: f.properties.source },
      })),
      objectIdField: 'ObjectID',
      geometryType: 'point',
      spatialReference: { wkid: 4326 },
      fields: [
        { name: 'ObjectID', type: 'oid' },
        { name: 'name', type: 'string', alias: 'الاسم' },
        { name: 'siteType', type: 'string', alias: 'النوع' },
        { name: 'externalId', type: 'string', alias: 'معرّف OSM' },
        { name: 'source', type: 'string', alias: 'المصدر' },
      ],
      renderer: renderer('siteType'),
      popupTemplate: { title: '{name}', content: [{ type: 'fields', fieldInfos: [{ fieldName: 'siteType', label: 'النوع' }, { fieldName: 'externalId', label: 'معرّف OSM' }, { fieldName: 'source', label: 'المصدر' }] }] },
    });
  }
}

function line(color: readonly number[], width: number, style: 'solid' | 'dash' = 'solid'): SimpleLineSymbol {
  return new SimpleLineSymbol({ color: [...color], width, style, cap: 'round' });
}

function marker(color: readonly number[]): SimpleMarkerSymbol {
  return new SimpleMarkerSymbol({ style: 'circle', size: 13, color: [...color], outline: { color: [255, 255, 255], width: 2 } });
}
