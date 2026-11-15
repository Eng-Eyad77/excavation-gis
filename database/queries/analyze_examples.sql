-- =====================================================================
-- analyze_examples.sql — the exact spatial SQL the API runs, runnable by hand.
--   cd database\queries
--   sqlplus excav@localhost:1521/FREEPDB1 @analyze_examples.sql
-- INDEX hints make Oracle use the spatial index even on these tiny seed tables (see explain_plan.sql).
-- Binds (:wkt, :half_width, :start_date, :end_date, :exclude_id) are set by
-- _demo_binds.sql, which generate-seed.mjs writes from the real demo route.
-- =====================================================================
SET LINESIZE 220 PAGESIZE 100 LONG 400 LONGCHUNKSIZE 400
COLUMN name_ar FORMAT A30
COLUMN name FORMAT A45
COLUMN work_type FORMAT A16
COLUMN validity FORMAT A10
COLUMN area_geojson FORMAT A60 TRUNCATED
COLUMN overlap_geojson FORMAT A50 TRUNCATED

@@_demo_binds.sql

PROMPT ===== 1) Validity + geodesic length/area + buffer (one round trip) =====
-- SDO_BUFFER on SRID 4326 is geodesic: the distance is in metres on the ellipsoid.
-- arc_tolerance: max distance (m) between a true arc and its chord in the buffer's rounded ends.
WITH g AS (SELECT SDO_GEOMETRY(:wkt, 4326) AS route FROM dual),
     b AS (SELECT route,
                  SDO_GEOM.SDO_BUFFER(route, :half_width, 0.05, 'unit=M arc_tolerance=0.5') AS area
           FROM g)
SELECT SDO_GEOM.VALIDATE_GEOMETRY_WITH_CONTEXT(route, 0.05) AS validity,
       ROUND(SDO_GEOM.SDO_LENGTH(route, 0.05, 'unit=M'), 2)  AS length_m,
       ROUND(SDO_GEOM.SDO_AREA(area, 0.05, 'unit=SQ_M'), 2)  AS area_m2,
       SDO_UTIL.TO_GEOJSON(area)                             AS area_geojson
FROM b;

PROMPT ===== 2) Inside Jeddah? (expect 1) =====
-- SDO_RELATE: first argument is the INDEXED column (city_boundary.geom).
SELECT /*+ INDEX(c city_geom_sidx) */ COUNT(*) AS inside_jeddah
FROM city_boundary c
WHERE SDO_RELATE(c.geom, SDO_GEOMETRY(:wkt, 4326), 'mask=CONTAINS+COVERS') = 'TRUE';

PROMPT ===== 3) Spatio-temporal conflicts (space AND time) =====
-- Space: excavation AREAS interact (ANYINTERACT) — uses spatial index EXCAV_AREA_SIDX.
-- Time : date ranges overlap  (a.start <= b.end AND a.end >= b.start).
SELECT /*+ INDEX(e excav_area_sidx) */ e.id, a.name_ar, e.work_type, e.status,
       TO_CHAR(e.start_date,'YYYY-MM-DD') AS start_date, TO_CHAR(e.end_date,'YYYY-MM-DD') AS end_date,
       LEAST(e.end_date, TO_DATE(:end_date,'YYYY-MM-DD'))
         - GREATEST(e.start_date, TO_DATE(:start_date,'YYYY-MM-DD')) + 1 AS overlap_days,
       ROUND(SDO_GEOM.SDO_AREA(SDO_GEOM.SDO_INTERSECTION(e.area_geom, q.area, 0.05), 0.05, 'unit=SQ_M'), 2) AS overlap_m2,
       SDO_UTIL.TO_GEOJSON(SDO_GEOM.SDO_INTERSECTION(e.area_geom, q.area, 0.05)) AS overlap_geojson
FROM excavations e
JOIN agencies a ON a.id = e.agency_id
CROSS JOIN (SELECT SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05,
                                       'unit=M arc_tolerance=0.5') AS area FROM dual) q
WHERE SDO_RELATE(e.area_geom, q.area, 'mask=ANYINTERACT') = 'TRUE'
  AND e.status IN ('Pending','Approved')
  AND e.start_date <= TO_DATE(:end_date,'YYYY-MM-DD')
  AND e.end_date   >= TO_DATE(:start_date,'YYYY-MM-DD')
  AND (:exclude_id IS NULL OR e.id <> :exclude_id);

PROMPT ===== 4) Sensitive sites within 50 m =====
-- SDO_WITHIN_DISTANCE: index-assisted distance filter; SDO_DISTANCE gives the exact metres.
SELECT /*+ INDEX(s sens_geom_sidx) */ s.id, s.name, s.site_type,
       ROUND(SDO_GEOM.SDO_DISTANCE(s.geom, SDO_GEOMETRY(:wkt, 4326), 0.05, 'unit=M'), 1) AS distance_m
FROM sensitive_sites s
WHERE SDO_WITHIN_DISTANCE(s.geom, SDO_GEOMETRY(:wkt, 4326), 'distance=50 unit=M') = 'TRUE'
ORDER BY distance_m;

PROMPT ===== 5) Recently paved roads (last 12 months) crossed by the excavation area =====
SELECT /*+ INDEX(p paved_geom_sidx) */ p.id, p.name, TO_CHAR(p.paved_date,'YYYY-MM-DD') AS paved_date,
       TRUNC(MONTHS_BETWEEN(SYSDATE, p.paved_date)) AS months_since
FROM paved_roads p
CROSS JOIN (SELECT SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05,
                                       'unit=M arc_tolerance=0.5') AS area FROM dual) q
WHERE SDO_RELATE(p.geom, q.area, 'mask=ANYINTERACT') = 'TRUE'
  AND p.paved_date >= ADD_MONTHS(SYSDATE, -12);

EXIT
