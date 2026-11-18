// Generates database/02_seed.sql and data/sensitive_sites.geojson from the
// cached OpenStreetMap files in data/osm/ (see fetch-osm.mjs).
//   node data/scripts/generate-seed.mjs
// Every real-world coordinate comes from OSM. Only excavation requests,
// agencies' dates and paving dates are sample values (بيانات تجريبية).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OSM = join(ROOT, 'data', 'osm');
const load = async (n) => JSON.parse(await readFile(join(OSM, n), 'utf8'));

// ---------------------------------------------------------------- geometry
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const LAT0 = 21.55; // local projection origin (central Jeddah)
const KX = R * rad(1) * Math.cos(rad(LAT0));
const KY = R * rad(1);
// Local equirectangular projection (metres). Good to <0.5% over a few km —
// used only for choosing segments and sanity checks; Oracle does the real geodesic math.
const toXY = ([lon, lat]) => [lon * KX, lat * KY];

function haversine(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const lineLength = (c) => c.slice(1).reduce((s, p, i) => s + haversine(c[i], p), 0);

// Distance (m) from point p to polyline c, plus the along-line position (m) of the closest point
function pointToLine(p, c) {
  const P = toXY(p);
  let best = { dist: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const A = toXY(c[i]), B = toXY(c[i + 1]);
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const segLen = Math.hypot(dx, dy);
    const t = segLen === 0 ? 0 : Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / segLen ** 2));
    const d = Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy));
    if (d < best.dist) best = { dist: d, along: acc + t * segLen };
    acc += segLen;
  }
  return best;
}
const lineToLine = (a, b) => Math.min(...a.map((p) => pointToLine(p, b).dist), ...b.map((p) => pointToLine(p, a).dist));

// Sub-line of c between along-distances s0..s1 (m). End points are interpolated
// ON the real OSM segments, interior points are the real OSM vertices.
function subLine(c, s0, s1) {
  const out = [];
  let acc = 0;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let i = 0; i < c.length - 1; i++) {
    const A = toXY(c[i]), B = toXY(c[i + 1]);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const a0 = acc, a1 = acc + L;
    if (a1 >= s0 && a0 <= s1) {
      if (out.length === 0) out.push(lerp(c[i], c[i + 1], L ? Math.max(0, (s0 - a0) / L) : 0));
      if (a1 <= s1) out.push(c[i + 1]);
      else { out.push(lerp(c[i], c[i + 1], (s1 - a0) / L)); break; }
    }
    acc = a1;
  }
  return out;
}

// Douglas–Peucker in local metres, made topology-safe for rings:
// plain DP can make a ring cross itself (Oracle then rejects it with ORA-13349),
// so wherever two simplified edges cross, the original vertices of both spans are restored.
function simplify(pts, tol) {
  const keep = dpMask(pts, tol);
  const segCross = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let pass = 0; pass < 50; pass++) {
    const idx = [...keep.keys()].filter((i) => keep[i]);
    let fixed = false;
    for (let i = 0; i < idx.length - 1; i++) {
      for (let j = i + 2; j < idx.length - 1; j++) {
        if (i === 0 && j === idx.length - 2) continue; // adjacent through the closing vertex
        if (segCross(pts[idx[i]], pts[idx[i + 1]], pts[idx[j]], pts[idx[j + 1]])) {
          for (const [s, e] of [[idx[i], idx[i + 1]], [idx[j], idx[j + 1]]]) for (let k = s; k <= e; k++) keep[k] = 1;
          fixed = true;
        }
      }
    }
    if (!fixed) break;
  }
  return pts.filter((_, i) => keep[i]);
}

function dpMask(pts, tol) {
  const keep = new Uint8Array(pts.length).fill(pts.length < 3 ? 1 : 0);
  if (pts.length < 3) return keep;
  const xy = pts.map(toXY);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = xy[s], [bx, by] = xy[e];
    const L = Math.hypot(bx - ax, by - ay);
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = xy[i];
      const d = L === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return keep;
}

// Shoelace signed area in degrees² (>0 = counter-clockwise)
const signedArea = (ring) => ring.slice(0, -1).reduce((s, p, i) => s + (p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1]), 0) / 2;

// Join relation member lines (any direction) into closed rings
function assembleRings(lines) {
  const k = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const pool = lines.map((l) => l.slice());
  const rings = [];
  while (pool.length) {
    let ring = pool.shift();
    let grew = true;
    while (k(ring[0]) !== k(ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (k(l[0]) === k(ring.at(-1))) ring = ring.concat(l.slice(1));
        else if (k(l.at(-1)) === k(ring.at(-1))) ring = ring.concat(l.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1); grew = true; break;
      }
    }
    if (k(ring[0]) === k(ring.at(-1)) && ring.length >= 4) rings.push(ring);
    else console.warn(`  warning: dropped an unclosed boundary piece (${ring.length} pts)`);
  }
  return rings;
}

// Stitch one-way street ways head-to-tail (keeps OSM direction = one carriageway)
function stitch(features) {
  const k = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const chains = features.map((f) => ({ ids: [f.properties.osm_id], c: f.geometry.coordinates.slice() }));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (const a of chains) for (const b of chains) {
      if (a !== b && k(a.c.at(-1)) === k(b.c[0])) {
        a.c = a.c.concat(b.c.slice(1)); a.ids.push(...b.ids);
        chains.splice(chains.indexOf(b), 1); merged = true; break outer;
      }
    }
  }
  return chains.sort((x, y) => lineLength(y.c) - lineLength(x.c));
}

// ---------------------------------------------------------------- SQL helpers
const num = (v) => v.toFixed(7).replace(/\.?0+$/, '');
const wktLine = (c) => `LINESTRING (${c.map((p) => `${num(p[0])} ${num(p[1])}`).join(', ')})`;
const wktPoint = (p) => `POINT (${num(p[0])} ${num(p[1])})`;
const wktPolygon = (ring) => `POLYGON ((${ring.map((p) => `${num(p[0])} ${num(p[1])}`).join(', ')}))`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Split a long WKT into SQL*Plus-safe pieces appended to a CLOB in PL/SQL
function clobBuilder(varName, text, chunk = 1000) {
  const parts = [];
  for (let i = 0; i < text.length; i += chunk) parts.push(`  DBMS_LOB.APPEND(${varName}, ${q(text.slice(i, i + chunk))});`);
  return parts.join('\n');
}

// ================================================================ main
const boundaryFc = await load('jeddah_boundary.geojson');
const tahliaFc = await load('tahlia_street.geojson');
const sitesFc = await load('sensitive_sites_raw.geojson');
const palestineFc = await load('palestine_street.geojson');

// ---- 1. Jeddah boundary: assemble, keep the largest outer ring, simplify, CCW
const rel = boundaryFc.features[0];
if (!rel) throw new Error('No Jeddah boundary in data/osm/jeddah_boundary.geojson');
const rings = assembleRings(rel.geometry.coordinates);
rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
// The governorate is large (coast + desert): raise the Douglas–Peucker tolerance
// from 40 m until the ring has at most ~500 vertices (keeps Oracle and the browser fast).
let simplifyTol = 40;
let ring = simplify(rings[0], simplifyTol);
while (ring.length > 500 && simplifyTol < 2000) ring = simplify(rings[0], (simplifyTol *= 1.25));
if (signedArea(ring) < 0) ring.reverse(); // Oracle: exterior ring counter-clockwise
const boundaryName = rel.properties['name:ar'] ?? rel.properties.name;

// ---- 2. Demo street
// Rule: the sample segment must have a REAL school/hospital within 50 m.
// Try Tahlia first; if none qualifies, fall back to the real main road with the closest named school.
const mainRoadsFc = await load('main_roads.geojson');
const allSites = sitesFc.features
  .map((f) => ({
    name: f.properties['name:ar'] ?? f.properties.name ?? f.properties['name:en'] ?? null,
    siteType: f.properties.amenity === 'hospital' ? 'Hospital' : 'School',
    externalId: `${f.properties.osm_type}/${f.properties.osm_id}`,
    coord: f.geometry.coordinates,
  }))
  .filter((s) => s.name); // only named, identifiable places

const MAX_SITE_DIST = 45; // keep a margin under the 50 m rule
// Closest named site (optionally only schools) to the one-way carriageways of a street
function bestPick(features, schoolsOnly) {
  const cws = stitch(features.filter((f) => f.properties.oneway === 'yes' && f.geometry.type === 'LineString'));
  let best = null;
  for (const cw of cws) for (const s of allSites) {
    if (schoolsOnly && s.siteType !== 'School') continue;
    const r = pointToLine(s.coord, cw.c);
    if (!best || r.dist < best.dist) best = { cw, site: s, ...r };
  }
  return best;
}

let pick = bestPick(tahliaFc.features.filter((f) => f.properties.highway === 'primary'), false);
let streetName = 'شارع الأمير محمد بن عبدالعزيز (التحلية)';
const tahliaClosest = pick?.dist;
let fallbackUsed = false;
if (!pick || pick.dist > MAX_SITE_DIST) {
  fallbackUsed = true;
  const byName = Map.groupBy(mainRoadsFc.features, (f) => f.properties.name);
  pick = null;
  for (const [name, feats] of byName) {
    const p = bestPick(feats, true);
    if (p && p.dist <= MAX_SITE_DIST && lineLength(p.cw.c) >= 1000 && (!pick || p.dist < pick.dist)) {
      pick = p; streetName = name;
    }
  }
  if (!pick) throw new Error('No real main road with a named school within 45 m was found.');
}
const street = pick.cw.c;
const streetLen = lineLength(street);
// Sites stored in Oracle: every named school/hospital within 300 m of the demo street
// OSM sometimes has duplicate nodes for one place: within 10 m keep the longest (most descriptive) name
const sites = [];
for (const s of allSites.filter((x) => pointToLine(x.coord, street).dist <= 300).sort((a, b) => b.name.length - a.name.length)) {
  if (!sites.some((k) => k.siteType === s.siteType && haversine(k.coord, s.coord) < 10)) sites.push(s);
}

// Demo route: ~1.4 km of the real carriageway centred on the sensitive site
// (shorter if the carriageway itself is shorter; leaves 500 m for the NWC overrun when possible)
const routeLen = Math.min(1400, streetLen - 200);
const s0 = Math.max(0, Math.min(pick.along - routeLen / 2, streetLen - routeLen - 500));
const s1 = Math.min(streetLen, s0 + routeLen);
const demoRoute = subLine(street, s0, s1);
// Paved road (sample date): middle part of the demo street
const pavedLine = subLine(street, s0 + routeLen * 0.2, s0 + routeLen * 0.7);
// NWC water excavation: starts inside the demo route and continues 500 m beyond its end
const nwcLine = subLine(street, s1 - 600, Math.min(streetLen, s1 + 500));

// ---- 3. SEC sample excavation on Palestine Street, far from the demo route
const palestine = stitch(palestineFc.features.filter((f) => f.properties.highway === 'primary'));
let secLine = null;
let secCw = null;
let secS = 0;
for (const cw of palestine) {
  const L = lineLength(cw.c);
  for (let s = 0; s + 600 <= L && !secLine; s += 200) {
    const seg = subLine(cw.c, s, s + 600);
    if (lineToLine(seg, demoRoute) > 800) { secLine = seg; secCw = cw; secS = s; }
  }
  if (secLine) break;
}
if (!secLine) throw new Error('Could not find a Palestine Street segment >800 m from the demo route');
const palestineName = palestineFc.features.find((f) => f.properties.highway === 'primary').properties.name;

// ---- 4. AMANA road works on the same Palestine carriageway, overlapping the SEC request by ~300 m
//      (dates overlap too) so the reviewer sees a conflict on a seeded Pending request.
const secCwLen = lineLength(secCw.c);
const amanaLine = secS + 900 <= secCwLen
  ? subLine(secCw.c, secS + 300, secS + 900)
  : subLine(secCw.c, Math.max(0, secS - 300), secS + 300);

// ---- 5. Rejected request + its re-submission on another real main road (inside Jeddah,
//      far from every other sample so neither one changes the demo results).
const insideCity = ([x, y]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
let rejLine = null;
let rejName = null;
const otherRoads = [...Map.groupBy(mainRoadsFc.features, (f) => f.properties.name)]
  .filter(([name]) => name && name !== streetName && name !== palestineName)
  .sort(([a], [b]) => a.localeCompare(b)); // deterministic
for (const [name, feats] of otherRoads) {
  for (const cw of stitch(feats.filter((f) => f.geometry.type === 'LineString'))) {
    if (lineLength(cw.c) < 900) continue;
    const seg = subLine(cw.c, 100, 900);
    if (seg.every(insideCity) && lineToLine(seg, demoRoute) > 1500 && lineToLine(seg, nwcLine) > 1500
        && lineToLine(seg, secLine) > 1500 && lineToLine(seg, amanaLine) > 1500) {
      rejLine = seg; rejName = name; break;
    }
  }
  if (rejLine) break;
}
if (!rejLine) throw new Error('Could not find another main road for the rejected/resubmitted samples');
// Re-submission: the same street, shortened to the first 500 m (smaller works area)
const resubLine = subLine(rejLine, 0, 500);

// ---------------------------------------------------------------- sanity check
const ESC = (s) => s.replace(/\n/g, ' ');
console.log('\n=== Sanity check (local projection, ±0.5%) ===');
console.log(`Boundary  : ${boundaryName} — ${rings[0].length} -> ${ring.length} vertices (DP ${simplifyTol.toFixed(0)} m), CCW=${signedArea(ring) > 0}`);
console.log(`Tahlia    : closest named school/hospital ${tahliaClosest?.toFixed(1)} m${fallbackUsed ? ' (> 45 m -> fallback street used)' : ''}`);
console.log(`Street    : ${streetName} (carriageway of ${pick.cw.ids.length} OSM ways: ${pick.cw.ids.join(',')}, ${(streetLen / 1000).toFixed(2)} km)`);
console.log(`Anchor    : ${pick.site.name} (${pick.site.externalId}) ${pick.dist.toFixed(1)} m from the carriageway`);
console.log(`Demo route: ${demoRoute.length} pts, ${lineLength(demoRoute).toFixed(0)} m`);
console.log(`Paved road: ${lineLength(pavedLine).toFixed(0)} m, max offset from demo route ${Math.max(...pavedLine.map((p) => pointToLine(p, demoRoute).dist)).toFixed(2)} m (must be < 0.75 m = demo half-width)`);
console.log(`NWC excav.: ${lineLength(nwcLine).toFixed(0)} m, shared length with demo route ≈ ${(s1 - (s1 - 600)).toFixed(0)} m, offset ${pointToLine(nwcLine[1], demoRoute).dist.toFixed(2)} m`);
console.log(`SEC excav.: ${palestineName}, ${lineLength(secLine).toFixed(0)} m, min distance to demo route ${lineToLine(secLine, demoRoute).toFixed(0)} m`);
console.log(`AMANA works: ${palestineName}, ${lineLength(amanaLine).toFixed(0)} m, shares ≈ 300 m with SEC, min distance to demo route ${lineToLine(amanaLine, demoRoute).toFixed(0)} m`);
console.log(`Rejected  : ${rejName}, ${lineLength(rejLine).toFixed(0)} m; re-submission ${lineLength(resubLine).toFixed(0)} m; min distance to demo route ${lineToLine(rejLine, demoRoute).toFixed(0)} m`);
console.log('Sensitive sites -> distance to demo route:');
const siteRows = sites.map((s) => ({ ...s, d: pointToLine(s.coord, demoRoute).dist })).sort((a, b) => a.d - b.d);
for (const s of siteRows) console.log(`  ${s.d.toFixed(1).padStart(7)} m  ${s.siteType.padEnd(8)} ${ESC(s.name)}  (${s.externalId})${s.d <= 50 ? '  <= 50 m ✔' : ''}`);

// ---------------------------------------------------------------- 02_seed.sql
const SAMPLE = 'بيانات تجريبية';
const excav = (code, workType, width, start, end, status, line, note, reviewNote = null) => `
INSERT INTO excavations (agency_id, work_type, width_m, start_date, end_date, status, notes, review_note, reviewed_at, route_geom, area_geom, length_m, area_m2)
SELECT a.id, ${q(workType)}, ${width}, DATE '${start}', DATE '${end}', ${q(status)}, ${q(note)},
       ${reviewNote ? q(reviewNote) : 'NULL'}, ${status === 'Pending' ? 'NULL' : 'SYSTIMESTAMP'},
       r.g,
       SDO_GEOM.SDO_BUFFER(r.g, ${width / 2}, 0.05, 'unit=M arc_tolerance=0.5'),
       ROUND(SDO_GEOM.SDO_LENGTH(r.g, 0.05, 'unit=M'), 2),
       ROUND(SDO_GEOM.SDO_AREA(SDO_GEOM.SDO_BUFFER(r.g, ${width / 2}, 0.05, 'unit=M arc_tolerance=0.5'), 0.05, 'unit=SQ_M'), 2)
FROM agencies a,
     (SELECT SDO_GEOMETRY(${q(wktLine(line))}, 4326) AS g FROM dual) r
WHERE a.code = ${q(code)};`;

const sql = `-- =====================================================================
-- 02_seed.sql  —  GENERATED by data/scripts/generate-seed.mjs. Do not edit by hand.
--   sqlplus excav@localhost:1521/FREEPDB1 @database/02_seed.sql
-- Real geometry: © OpenStreetMap contributors (ODbL), fetched via Overpass API.
-- Sample values (${SAMPLE}): excavation requests, their dates/agencies, paving dates.
-- Users are NOT seeded here — the API seeds them at startup with hashed passwords.
-- Arabic text: this file is UTF-8. In CMD run first:  set NLS_LANG=AMERICAN_AMERICA.AL32UTF8
-- =====================================================================
WHENEVER SQLERROR EXIT SQL.SQLCODE
SET DEFINE OFF
SET SQLBLANKLINES ON
SET SERVEROUTPUT ON

-- ---- Agencies (static)
INSERT INTO agencies (code, name_ar, name_en) VALUES ('STC',   'شركة الاتصالات السعودية', 'Saudi Telecom');
INSERT INTO agencies (code, name_ar, name_en) VALUES ('NWC',   'شركة المياه الوطنية', 'National Water Company');
INSERT INTO agencies (code, name_ar, name_en) VALUES ('SEC',   'الشركة السعودية للكهرباء', 'Saudi Electricity');
INSERT INTO agencies (code, name_ar, name_en) VALUES ('AMANA', 'أمانة محافظة جدة - صيانة الطرق', 'Jeddah Municipality Roads');

-- ---- City boundary: OSM relation ${rel.properties.osm_id} (${boundaryName}),
--      simplified (Douglas–Peucker ${simplifyTol.toFixed(0)} m) to ${ring.length} vertices, exterior ring CCW.
--      The WKT is longer than a SQL literal allows, so it is built as a CLOB in PL/SQL.
DECLARE
  l_wkt CLOB;
BEGIN
  DBMS_LOB.CREATETEMPORARY(l_wkt, TRUE);
${clobBuilder('l_wkt', wktPolygon(ring))}
  INSERT INTO city_boundary (name, geom) VALUES (${q(boundaryName)}, SDO_GEOMETRY(l_wkt, 4326));
  DBMS_LOB.FREETEMPORARY(l_wkt);
END;
/

-- ---- Sensitive sites: real OSM schools/hospitals within 300 m of ${streetName}
${siteRows.map((s) => `INSERT INTO sensitive_sites (name, site_type, source, external_id, geom) VALUES (${q(s.name)}, ${q(s.siteType)}, 'Seed', ${q(s.externalId)}, SDO_GEOMETRY(${q(wktPoint(s.coord))}, 4326));`).join('\n')}

-- ---- Paved road (${SAMPLE}: paving date 2026-07-15) — sub-segment of the demo street
INSERT INTO paved_roads (name, paved_date, geom) VALUES (${q(streetName)}, DATE '2026-07-15',
  SDO_GEOMETRY(${q(wktLine(pavedLine))}, 4326));

-- ---- Existing excavations (${SAMPLE})
-- 1) NWC water pipeline on the demo street, overlapping the demo route (space AND time)
${excav('NWC', 'Water pipeline', 2.0, '2026-12-10', '2026-12-20', 'Approved', nwcLine, `${SAMPLE} - ${streetName}`)}
-- 2) SEC electric cable on ${palestineName} — does NOT touch the demo route
${excav('SEC', 'Electric cable', 1.0, '2026-12-01', '2026-12-05', 'Pending', secLine, `${SAMPLE} - ${palestineName}`)}
-- 3) AMANA road works on the same ${palestineName} carriageway: overlaps the SEC request in
--    space AND time (2026-12-03..05 = 3 days), so the reviewer sees a conflict on request 2
${excav('AMANA', 'Road works', 3.0, '2026-12-03', '2026-12-08', 'Approved', amanaLine, `${SAMPLE} - ${palestineName}`, 'معتمد: صيانة دورية للطريق')}
-- 4) Rejected request on ${rejName} (far from every other sample)
${excav('NWC', 'Sewage pipeline', 2.0, '2027-01-05', '2027-03-05', 'Rejected', rejLine, `${SAMPLE} - ${rejName}`, 'مرفوض: مدة شهرين على طريق رئيسي طويلة جداً. يُعاد التقديم بمرحلة أقصر وطول أقل.')}
-- 5) Re-submission of request 4: same street, shorter route (500 m) and a 10-day window -> Pending.
--    Request 4 is Rejected, so it is NOT counted as a conflict (only Pending/Approved are).
${excav('NWC', 'Sewage pipeline', 2.0, '2027-01-10', '2027-01-20', 'Pending', resubLine, `${SAMPLE} - إعادة تقديم للطلب المرفوض على ${rejName}: مسار أقصر ومدة 10 أيام`)}

COMMIT;

-- ---- Validate every stored geometry (expect TRUE for all rows)
PROMPT Geometry validation (expect TRUE):
SELECT 'city_boundary' AS tbl, id, SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(geom, 0.05) AS validity FROM city_boundary
UNION ALL SELECT 'paved_roads', id, SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(geom, 0.05) FROM paved_roads
UNION ALL SELECT 'excavations.route', id, SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(route_geom, 0.05) FROM excavations
UNION ALL SELECT 'excavations.area', id, SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(area_geom, 0.05) FROM excavations
UNION ALL SELECT 'sensitive_sites', id, SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(geom, 0.05) FROM sensitive_sites;

PROMPT Row counts:
SELECT 'agencies' AS tbl, COUNT(*) AS n FROM agencies
UNION ALL SELECT 'city_boundary', COUNT(*) FROM city_boundary
UNION ALL SELECT 'sensitive_sites', COUNT(*) FROM sensitive_sites
UNION ALL SELECT 'paved_roads', COUNT(*) FROM paved_roads
UNION ALL SELECT 'excavations', COUNT(*) FROM excavations;
EXIT
`;
await writeFile(join(ROOT, 'database', '02_seed.sql'), sql);

// ---------------------------------------------------------------- GeoJSON for ArcGIS Online
await writeFile(join(ROOT, 'data', 'sensitive_sites.geojson'), JSON.stringify({
  type: 'FeatureCollection',
  features: siteRows.map((s) => ({
    type: 'Feature',
    properties: { name: s.name, site_type: s.siteType, external_id: s.externalId },
    geometry: { type: 'Point', coordinates: s.coord },
  })),
}, null, 2));

// ---------------------------------------------------------------- demo route (for README / Swagger)
const demoBody = {
  paths: [demoRoute.map((p) => [+num(p[0]), +num(p[1])])],
  widthMeters: 1.5,
  startDate: '2026-12-01',
  endDate: '2026-12-15',
  workType: 'Fiber cable',
  notes: 'Demo route on ' + streetName,
};
await writeFile(join(ROOT, 'data', 'demo_route.json'), JSON.stringify(demoBody, null, 2));
// Same route for the frontend's "load demo route" button (served from frontend/public)
await writeFile(join(ROOT, 'frontend', 'public', 'demo_route.json'), JSON.stringify(demoBody, null, 2));

// SQL*Plus bind variables with the same demo request (used by database/queries/*.sql)
await writeFile(join(ROOT, 'database', 'queries', '_demo_binds.sql'), `-- GENERATED by data/scripts/generate-seed.mjs — the demo request as SQL*Plus binds.
SET DEFINE OFF
VARIABLE wkt        CLOB
VARIABLE half_width NUMBER
VARIABLE start_date VARCHAR2(10)
VARIABLE end_date   VARCHAR2(10)
VARIABLE exclude_id NUMBER
BEGIN
  :wkt        := ${q(wktLine(demoRoute))};
  :half_width := ${demoBody.widthMeters / 2};
  :start_date := '${demoBody.startDate}';
  :end_date   := '${demoBody.endDate}';
  :exclude_id := NULL;
END;
/
`);

console.log(`\nWrote database/02_seed.sql, data/sensitive_sites.geojson (${siteRows.length} sites), data/demo_route.json`);
