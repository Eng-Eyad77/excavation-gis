import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol.js';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol.js';

/** Symbols shared by the applicant and reviewer screens. */

/** Route being drawn / edited by the applicant */
export const ROUTE_SYMBOL = new SimpleLineSymbol({ color: [234, 179, 8], width: 4, cap: 'round' });

/** Selected request on the reviewer map: halo under the status-coloured line */
export const SELECTED_ROUTE_SYMBOL = new SimpleLineSymbol({ color: [6, 182, 212, 0.6], width: 14, cap: 'round' });

/** Client-side geodesic buffer preview (dashed) */
export const CLIENT_BUFFER_SYMBOL = new SimpleFillSymbol({
  color: [234, 179, 8, 0.15], outline: { color: [161, 98, 7], width: 1, style: 'dash' },
});

/** Excavation area computed by Oracle (SDO_BUFFER) */
export const SERVER_AREA_SYMBOL = new SimpleFillSymbol({
  color: [29, 106, 143, 0.35], outline: { color: [15, 61, 94], width: 1.5 },
});

// Overlaps are only ~1.5 m wide: a thick outline keeps them visible at street zoom levels.
export const OVERLAP_SYMBOL = new SimpleFillSymbol({
  color: [220, 38, 38, 0.6], outline: { color: [220, 38, 38, 0.9], width: 7 },
});
export const OVERLAP_SELECTED_SYMBOL = new SimpleFillSymbol({
  color: [185, 28, 28, 0.9], outline: { color: [185, 28, 28], width: 10 },
});
