import Point from '@arcgis/core/geometry/Point.js';
import Polygon from '@arcgis/core/geometry/Polygon.js';
import Polyline from '@arcgis/core/geometry/Polyline.js';
import SpatialReference from '@arcgis/core/geometry/SpatialReference.js';
import * as webMercatorUtils from '@arcgis/core/geometry/support/webMercatorUtils.js';
import { GeoJsonGeometry, LonLat, Position } from '../core/models';

/*
 * GeoJSON <-> ArcGIS geometry conversion.
 *
 * WHY RING ORIENTATION MATTERS
 * A polygon ring is a closed list of vertices; its direction tells which side is "inside".
 *   - GeoJSON (RFC 7946) and Oracle Spatial: exterior ring COUNTER-CLOCKWISE, holes clockwise.
 *   - Esri / ArcGIS JSON:                    exterior ring CLOCKWISE,         holes counter-clockwise.
 * If a CCW exterior ring is handed to ArcGIS unchanged it is read as a HOLE, so the polygon
 * can disappear or render inside-out. We detect each ring's direction with the shoelace
 * formula (signed area: > 0 = CCW, < 0 = CW) and reverse rings that point the wrong way.
 *
 * Coordinates are always [lon, lat] = [x, y] in WGS84 (wkid 4326).
 */

const WGS84 = SpatialReference.WGS84;

/** Shoelace formula. Positive = counter-clockwise, negative = clockwise (x right, y up). */
export function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

const clockwise = (ring: Position[]): Position[] => (signedArea(ring) > 0 ? [...ring].reverse() : ring);
const counterClockwise = (ring: Position[]): Position[] => (signedArea(ring) < 0 ? [...ring].reverse() : ring);

/** One GeoJSON polygon (exterior + holes) -> Esri rings: exterior CW, holes CCW. */
function toEsriRings(polygon: Position[][]): Position[][] {
  return polygon.map((ring, i) => (i === 0 ? clockwise(ring) : counterClockwise(ring)));
}

export function geoJsonToEsri(g: GeoJsonGeometry): Point | Polyline | Polygon {
  switch (g.type) {
    case 'Point':
      return new Point({ x: g.coordinates[0], y: g.coordinates[1], spatialReference: WGS84 });
    case 'LineString':
      return new Polyline({ paths: [g.coordinates], spatialReference: WGS84 });
    case 'MultiLineString':
      return new Polyline({ paths: g.coordinates, spatialReference: WGS84 });
    case 'Polygon':
      return new Polygon({ rings: toEsriRings(g.coordinates), spatialReference: WGS84 });
    case 'MultiPolygon':
      // Esri has no multipolygon type: all parts become rings of one Polygon.
      return new Polygon({ rings: g.coordinates.flatMap(toEsriRings), spatialReference: WGS84 });
  }
}

/** Esri polygon -> GeoJSON Polygon (exterior back to CCW). Single-exterior polygons only. */
export function esriPolygonToGeoJson(polygon: Polygon): GeoJsonGeometry {
  const geo = toWgs84(polygon) as Polygon;
  const rings = geo.rings.map((r, i) => (i === 0 ? counterClockwise(r) : clockwise(r)));
  return { type: 'Polygon', coordinates: rings };
}

/**
 * Sketch geometries come in the VIEW's spatial reference (Web Mercator, wkid 3857/102100).
 * The API expects WGS84 lon/lat, so convert first. isWebMercator also covers 102100/102113/900913.
 */
export function toWgs84<T extends Polyline | Polygon | Point>(geometry: T): T {
  const sr = geometry.spatialReference;
  if (sr?.isWGS84) return geometry;
  if (sr?.isWebMercator) return webMercatorUtils.webMercatorToGeographic(geometry) as T;
  throw new Error(`Unsupported spatial reference ${sr?.wkid}; project it to WGS84 first.`);
}

/** Esri polyline (any SR supported by toWgs84) -> API "paths": [[[lon, lat], ...], ...] */
export function polylineToPaths(polyline: Polyline): LonLat[][] {
  const geo = toWgs84(polyline);
  const round = (n: number) => Math.round(n * 1e7) / 1e7; // ~1 cm
  return geo.paths.map((path) => path.map((p) => [round(p[0]), round(p[1])] as LonLat));
}
