import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from './app-config';
import {
  Agency, AnalysisResult, AnalyzeRequest, BoundaryProps, CreateExcavationResponse, Excavation,
  ExcavationDetail, ExcavationStatus, FeatureCollection, PavedRoadProps, ProblemDetails,
  SensitiveSiteProps, SyncResult,
} from './models';

/** Typed calls for every API endpoint (Promise-based for simple async/await in components). */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AppConfig);

  private get base(): string {
    return this.config.value.apiUrl;
  }

  agencies(): Promise<Agency[]> {
    return firstValueFrom(this.http.get<Agency[]>(`${this.base}/agencies`));
  }

  analyze(body: AnalyzeRequest): Promise<AnalysisResult> {
    return firstValueFrom(this.http.post<AnalysisResult>(`${this.base}/excavations/analyze`, body));
  }

  createExcavation(body: AnalyzeRequest): Promise<CreateExcavationResponse> {
    return firstValueFrom(this.http.post<CreateExcavationResponse>(`${this.base}/excavations`, body));
  }

  excavations(filter: { status?: ExcavationStatus | ''; agencyId?: number | null } = {}): Promise<Excavation[]> {
    let params = new HttpParams();
    if (filter.status) params = params.set('status', filter.status);
    if (filter.agencyId) params = params.set('agencyId', filter.agencyId);
    return firstValueFrom(this.http.get<Excavation[]>(`${this.base}/excavations`, { params }));
  }

  excavation(id: number): Promise<ExcavationDetail> {
    return firstValueFrom(this.http.get<ExcavationDetail>(`${this.base}/excavations/${id}`));
  }

  approve(id: number, note: string | null): Promise<Excavation> {
    return firstValueFrom(this.http.post<Excavation>(`${this.base}/excavations/${id}/approve`, { note }));
  }

  reject(id: number, note: string): Promise<Excavation> {
    return firstValueFrom(this.http.post<Excavation>(`${this.base}/excavations/${id}/reject`, { note }));
  }

  sensitiveSites(): Promise<FeatureCollection<SensitiveSiteProps>> {
    return firstValueFrom(this.http.get<FeatureCollection<SensitiveSiteProps>>(`${this.base}/layers/sensitive-sites`));
  }

  pavedRoads(): Promise<FeatureCollection<PavedRoadProps>> {
    return firstValueFrom(this.http.get<FeatureCollection<PavedRoadProps>>(`${this.base}/layers/paved-roads`));
  }

  cityBoundary(): Promise<FeatureCollection<BoundaryProps>> {
    return firstValueFrom(this.http.get<FeatureCollection<BoundaryProps>>(`${this.base}/layers/city-boundary`));
  }

  syncSensitiveSites(): Promise<SyncResult> {
    return firstValueFrom(this.http.post<SyncResult>(`${this.base}/integration/arcgis/sync-sensitive-sites`, {}));
  }
}

/** Arabic, user-facing message from any API error (ProblemDetails title, or a network hint). */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) return 'تعذّر الاتصال بالخادم. تأكد أن الـ API يعمل على المنفذ 5106.';
    const body = err.error as ProblemDetails | null;
    if (body?.title) return body.title;
    if (err.status === 403) return 'ليست لديك صلاحية لهذا الإجراء.';
    return `خطأ من الخادم (${err.status}).`;
  }
  return 'حدث خطأ غير متوقع.';
}
