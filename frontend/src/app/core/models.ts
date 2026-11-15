// TypeScript mirrors of the backend contracts (JSON camelCase).
// Dates are ISO strings "yyyy-MM-dd".

export type Role = 'Applicant' | 'Reviewer';
export type ExcavationStatus = 'Pending' | 'Approved' | 'Rejected';

/** [lon, lat] in WGS84 (EPSG:4326) */
export type LonLat = [number, number];

export interface LoginResponse {
  token: string;
  username: string;
  role: Role;
  agencyId: number | null;
  agencyName: string | null;
}

export interface Agency {
  id: number;
  code: string;
  nameAr: string;
  nameEn: string;
}

export interface AnalyzeRequest {
  paths: LonLat[][];
  widthMeters: number;
  startDate: string;
  endDate: string;
  workType: string;
  notes?: string | null;
}

export interface DigOnce {
  suggestedStartDate: string;
  suggestedEndDate: string;
  message: string;
}

export interface Conflict {
  excavationId: number;
  agencyName: string;
  workType: string;
  status: ExcavationStatus;
  startDate: string;
  endDate: string;
  overlapDays: number;
  overlapAreaSquareMeters: number;
  overlapGeoJson: GeoJsonGeometry | null;
  digOnce: DigOnce | null;
}

export interface SensitiveSiteHit {
  id: number;
  name: string;
  siteType: 'School' | 'Hospital';
  distanceMeters: number;
}

export interface PavedRoadHit {
  id: number;
  name: string;
  pavedDate: string;
  monthsSincePaving: number;
}

export interface AnalysisResult {
  isValid: boolean;
  errors: string[];
  lengthMeters: number | null;
  areaSquareMeters: number | null;
  areaGeoJson: GeoJsonGeometry | null;
  conflicts: Conflict[];
  sensitiveSites: SensitiveSiteHit[];
  pavedRoads: PavedRoadHit[];
  warnings: string[];
}

export interface Excavation {
  id: number;
  agencyId: number;
  agencyCode: string;
  agencyName: string;
  workType: string;
  widthMeters: number;
  startDate: string;
  endDate: string;
  status: ExcavationStatus;
  lengthMeters: number | null;
  areaSquareMeters: number | null;
  notes: string | null;
  reviewNote: string | null;
  createdBy: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  routeGeoJson: GeoJsonGeometry;
  areaGeoJson: GeoJsonGeometry;
}

export interface ExcavationDetail {
  excavation: Excavation;
  conflicts: Conflict[];
}

export interface CreateExcavationResponse {
  excavation: Excavation;
  analysis: AnalysisResult;
}

export interface SyncResult {
  imported: number;
  updated: number;
}

/** RFC 7807 error body from the API */
export interface ProblemDetails {
  title?: string;
  status?: number;
  errors?: string[];
  analysis?: AnalysisResult;
}

// ---------------------------------------------------------------- GeoJSON (subset we use)
export type Position = number[];

export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };

export interface GeoJsonFeature<P = Record<string, unknown>> {
  type: 'Feature';
  id?: number | string;
  properties: P;
  geometry: GeoJsonGeometry;
}

export interface FeatureCollection<P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: GeoJsonFeature<P>[];
}

export interface SensitiveSiteProps { id: number; name: string; siteType: string; source: string; externalId: string | null; }
export interface PavedRoadProps { id: number; name: string; pavedDate: string; isRecent: boolean; }
export interface BoundaryProps { id: number; name: string; }
