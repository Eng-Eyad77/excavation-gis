// Fetches real geographic data for Jeddah from OpenStreetMap (Overpass API)
// and caches it as GeoJSON in data/osm/. Run once:  node data/scripts/fetch-osm.mjs
// Re-run with --force to refetch. Data © OpenStreetMap contributors (ODbL).
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OSM_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'osm');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const USER_AGENT = 'excavation-gis-prototype/0.1 (educational GIS demo; one-time fetch)';
const FORCE = process.argv.includes('--force');

// Central Jeddah bbox (south, west, north, east)
const BBOX = '21.50,39.10,21.62,39.25';
const TAHLIA_REGEX = 'الأمير محمد بن عبدالعزيز|التحلية|Prince Mohammed bin Abdulaziz|Tahlia';
// A parallel main street (for the SEC sample excavation that must NOT touch the demo route)
const PALESTINE_REGEX = 'فلسطين|Palestine';

const QUERIES = {
  jeddah_boundary: `[out:json][timeout:90];
rel["boundary"="administrative"]["admin_level"="6"]["name"="محافظة جدة"](21.3,39.0,21.9,39.4);
out geom;`,
  tahlia_street: `[out:json][timeout:60];
way["highway"]["name"~"${TAHLIA_REGEX}",i](${BBOX});
out geom tags;`,
  // All schools/hospitals in the bbox; generate-seed.mjs keeps those within 300 m of Tahlia.
  // (An Overpass "around.<set>" filter returned nothing on the public servers, so we filter locally.)
  sensitive_sites_raw: `[out:json][timeout:60];
nwr["amenity"~"^(school|hospital)$"](${BBOX});
out center tags;`,
  // Fallback candidates if no real school/hospital lies within 50 m of Tahlia (§4.4)
  main_roads: `[out:json][timeout:90];
way["highway"~"^(trunk|primary|secondary)$"]["name"](${BBOX});
out geom tags;`,
  palestine_street: `[out:json][timeout:60];
way["highway"]["name"~"${PALESTINE_REGEX}",i](${BBOX});
out geom tags;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function overpass(query) {
  let lastErr;
  for (const [i, url] of ENDPOINTS.entries()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      const json = await res.json();
      // Overpass reports timeouts/memory errors as a 200 with a "remark" and partial/empty data
      if (json.remark && /error/i.test(json.remark)) throw new Error(`Overpass: ${json.remark}`);
      return json;
    } catch (e) {
      lastErr = e;
      console.warn(`  ${e.message} — ${i === 0 ? 'retrying on mirror after a pause' : 'giving up'}`);
      await sleep(10000);
    }
  }
  throw lastErr;
}

// ---- Overpass JSON -> GeoJSON ----
const toLonLat = (g) => g.map((p) => [p.lon, p.lat]);

function elementToFeature(el) {
  const props = { osm_type: el.type, osm_id: el.id, ...(el.tags ?? {}) };
  if (el.type === 'node') {
    return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [el.lon, el.lat] } };
  }
  if (el.center) {
    return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [el.center.lon, el.center.lat] } };
  }
  if (el.type === 'way' && el.geometry) {
    return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: toLonLat(el.geometry) } };
  }
  if (el.type === 'relation' && el.members) {
    // Keep raw outer/inner member lines; ring assembly happens in generate-seed.mjs
    const outer = el.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => toLonLat(m.geometry));
    const inner = el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => toLonLat(m.geometry));
    return {
      type: 'Feature',
      properties: { ...props, inner_member_count: inner.length },
      geometry: { type: 'MultiLineString', coordinates: outer },
    };
  }
  return null;
}

await mkdir(OSM_DIR, { recursive: true });
for (const [name, query] of Object.entries(QUERIES)) {
  const file = join(OSM_DIR, `${name}.geojson`);
  if (!FORCE && (await exists(file))) {
    console.log(`cached  ${name}`);
    continue;
  }
  console.log(`fetch   ${name} ...`);
  const json = await overpass(query);
  const features = json.elements.map(elementToFeature).filter(Boolean);
  const fc = {
    type: 'FeatureCollection',
    attribution: 'Data © OpenStreetMap contributors, ODbL',
    fetched_at: new Date().toISOString(),
    features,
  };
  await writeFile(file, JSON.stringify(fc, null, 1));
  console.log(`saved   ${name}: ${features.length} features`);
  await sleep(3000); // be polite to the public Overpass server
}
