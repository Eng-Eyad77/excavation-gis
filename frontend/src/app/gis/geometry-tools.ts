import Polygon from '@arcgis/core/geometry/Polygon.js';
import Polyline from '@arcgis/core/geometry/Polyline.js';
import SpatialReference from '@arcgis/core/geometry/SpatialReference.js';
import * as geodesicBufferOperator from '@arcgis/core/geometry/operators/geodesicBufferOperator.js';
import * as geodeticAreaOperator from '@arcgis/core/geometry/operators/geodeticAreaOperator.js';
import * as geodeticLengthOperator from '@arcgis/core/geometry/operators/geodeticLengthOperator.js';
import * as lengthOperator from '@arcgis/core/geometry/operators/lengthOperator.js';
import * as projectOperator from '@arcgis/core/geometry/operators/projectOperator.js';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils.js';
import { toWgs84 } from './geojson-esri';

/** UTM zone 37N on WGS84: the zone that covers Jeddah (36°E–42°E). */
export const UTM_37N = new SpatialReference({ wkid: 32637 });

/**
 * The geodetic and projection operators run in WebAssembly and must be loaded once
 * before execute() is called.
 */
export async function loadGeometryOperators(): Promise<void> {
  await Promise.all(
    [geodeticLengthOperator, geodesicBufferOperator, geodeticAreaOperator, projectOperator]
      .filter((op) => !op.isLoaded())
      .map((op) => op.load()),
  );
}

export interface LiveMeasurements {
  /** True length on the WGS84 ellipsoid */
  geodesicLengthM: number;
  /** Length measured on the flat Web Mercator plane (what the screen shows) */
  planarLengthM: number;
  /**
   * How much Web Mercator overstates the length: ≈ 1/cos(lat) - 1 = 7.5% east-west at Jeddah (21.5°N);
   * north-south it is ≈ 8.1% because Web Mercator uses a sphere while the true meridian is on the ellipsoid.
   */
  planarErrorPercent: number;
  /** Route buffered by width/2 on the ellipsoid: the excavation area */
  bufferPolygon: Polygon | null;
  geodesicAreaM2: number;
}

/**
 * Client-side preview while drawing (no server call). The server repeats the same math in
 * Oracle (SDO_LENGTH / SDO_BUFFER / SDO_AREA on SRID 4326); the numbers should agree closely.
 */
export function measureRoute(routeWebMercator: Polyline, widthMeters: number): LiveMeasurements {
  const geographic = toWgs84(routeWebMercator);
  const geodesicLengthM = geodeticLengthOperator.execute(geographic, { unit: 'meters' });

  // Planar length in the map's projection. Web Mercator stretches distances by 1/cos(latitude).
  const mercator = routeWebMercator.spatialReference.isWebMercator
    ? routeWebMercator
    : (webMercatorUtils.geographicToWebMercator(routeWebMercator) as Polyline);
  const planarLengthM = lengthOperator.execute(mercator, { unit: 'meters' });

  const bufferPolygon = widthMeters > 0
    ? (geodesicBufferOperator.execute(geographic, widthMeters / 2, { unit: 'meters' }) ?? null)
    : null;
  const geodesicAreaM2 = bufferPolygon ? geodeticAreaOperator.execute(bufferPolygon, { unit: 'square-meters' }) : 0;

  return {
    geodesicLengthM,
    planarLengthM,
    planarErrorPercent: geodesicLengthM > 0 ? ((planarLengthM - geodesicLengthM) / geodesicLengthM) * 100 : 0,
    bufferPolygon,
    geodesicAreaM2,
  };
}

// ---------------------------------------------------------------- UTM 37N <-> WGS84

export interface UtmParseResult {
  points: [number, number][];
  errors: string[];
}

/** Parses "easting,northing" lines (comma, semicolon, tab or spaces). Validates UTM 37N ranges. */
export function parseUtmText(text: string): UtmParseResult {
  const points: [number, number][] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))); // Arabic-Indic digits
    if (!line) return;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    const n = i + 1;
    if (parts.length !== 2) {
      errors.push(`السطر ${n}: يجب إدخال قيمتين فقط (easting,northing).`);
      return;
    }
    const [e, nVal] = parts.map(Number);
    if (!Number.isFinite(e) || !Number.isFinite(nVal)) {
      errors.push(`السطر ${n}: القيم يجب أن تكون أرقاماً.`);
      return;
    }
    if (Math.abs(e) <= 180 && Math.abs(nVal) <= 90) {
      errors.push(`السطر ${n}: القيم تبدو درجات (lon/lat) وليست أمتار UTM. ارسم المسار أو أدخل أمتار UTM.`);
      return;
    }
    // Easting: 500,000 m false easting ± ~334 km. Northing: 0 at the equator up to ~9,330 km at 84°N.
    if (e < 166000 || e > 834000) errors.push(`السطر ${n}: الإحداثي الشرقي (Easting) خارج النطاق 166000 – 834000 م.`);
    if (nVal < 0 || nVal > 9330000) errors.push(`السطر ${n}: الإحداثي الشمالي (Northing) خارج النطاق 0 – 9330000 م.`);
    points.push([e, nVal]);
  });

  if (points.length < 2 && errors.length === 0) errors.push('أدخل نقطتين على الأقل لتكوين مسار.');
  return { points, errors };
}

/** UTM 37N metres -> WGS84 polyline, via projectOperator (both are WGS84 datum: no datum shift needed). */
export function utmToWgs84Polyline(points: [number, number][]): Polyline {
  const utm = new Polyline({ paths: [points], spatialReference: UTM_37N });
  const geographic = projectOperator.execute(utm, SpatialReference.WGS84) as Polyline | null;
  if (!geographic) throw new Error('UTM projection failed');
  return geographic;
}

/** WGS84 polyline -> "easting,northing" text (used for the demo example in the UTM tab). */
export function wgs84PolylineToUtmText(polyline: Polyline): string {
  const utm = projectOperator.execute(polyline, UTM_37N) as Polyline;
  return utm.paths[0].map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('\n');
}
