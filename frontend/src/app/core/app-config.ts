import { Injectable } from '@angular/core';
import esriConfig from '@arcgis/core/config.js';
import { environment } from '../../environments/environment';

export interface RuntimeConfig {
  apiUrl: string;
  arcgisApiKey: string;
  sensitiveSitesLayerUrl: string;
}

/**
 * Settings = environment.ts defaults, overridden by the OPTIONAL, git-ignored
 * public/config.local.json (put your ArcGIS API key / hosted layer URL there).
 * Loaded once before the app starts, so the ArcGIS API key is set BEFORE any map exists.
 */
@Injectable({ providedIn: 'root' })
export class AppConfig {
  private config: RuntimeConfig = { ...environment };

  get value(): RuntimeConfig {
    return this.config;
  }

  async load(): Promise<void> {
    try {
      const res = await fetch('config.local.json', { cache: 'no-store' });
      if (res.ok) this.config = { ...this.config, ...((await res.json()) as Partial<RuntimeConfig>) };
    } catch {
      // no local file: keep the defaults
    }
    if (this.config.arcgisApiKey) esriConfig.apiKey = this.config.arcgisApiKey;
  }
}
