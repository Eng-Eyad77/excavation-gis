-- =====================================================================
-- explain_plan.sql: shows that the spatial queries use the spatial
-- (domain) indexes instead of scanning every row.
--   sqlplus excav@localhost:1521/FREEPDB1 @database\queries\explain_plan.sql
--
-- How a spatial index works (R-tree):
--   primary filter   = the index finds candidates whose bounding boxes (MBRs) interact
--   secondary filter = Oracle checks the exact geometry only for those candidates
--
-- Note: with only a few seed rows, the cost-based optimizer may decide a full scan is
-- cheaper (plan A). The INDEX hint (plan B, the form the API uses) forces the
-- domain-index access path, which is what a real table with thousands of rows gets.
-- =====================================================================
SET LINESIZE 200 PAGESIZE 200 TAB OFF TRIMOUT ON
COLUMN plan_table_output FORMAT A200

@@_demo_binds.sql

PROMPT
PROMPT ===== A) Conflict query, optimizer free to choose (tiny table, so a full scan is OK)
EXPLAIN PLAN SET STATEMENT_ID = 'CONFLICTS_FREE' FOR
SELECT e.id
FROM excavations e
CROSS JOIN (SELECT SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05,
                                       'unit=M arc_tolerance=0.5') AS area FROM dual) q
WHERE SDO_RELATE(e.area_geom, q.area, 'mask=ANYINTERACT') = 'TRUE'
  AND e.status IN ('Pending','Approved')
  AND e.start_date <= TO_DATE(:end_date,'YYYY-MM-DD')
  AND e.end_date   >= TO_DATE(:start_date,'YYYY-MM-DD');
SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'CONFLICTS_FREE', 'BASIC'));

PROMPT
PROMPT ===== B) Conflict query as the API runs it: look for DOMAIN INDEX EXCAV_AREA_SIDX
EXPLAIN PLAN SET STATEMENT_ID = 'CONFLICTS' FOR
SELECT /*+ INDEX(e excav_area_sidx) */
       e.id, e.work_type, e.status,
       SDO_GEOM.SDO_AREA(SDO_GEOM.SDO_INTERSECTION(e.area_geom, q.area, 0.05), 0.05, 'unit=SQ_M') AS overlap_m2
FROM excavations e
CROSS JOIN (SELECT SDO_GEOM.SDO_BUFFER(SDO_GEOMETRY(:wkt, 4326), :half_width, 0.05,
                                       'unit=M arc_tolerance=0.5') AS area FROM dual) q
WHERE SDO_RELATE(e.area_geom, q.area, 'mask=ANYINTERACT') = 'TRUE'
  AND e.status IN ('Pending','Approved')
  AND e.start_date <= TO_DATE(:end_date,'YYYY-MM-DD')
  AND e.end_date   >= TO_DATE(:start_date,'YYYY-MM-DD');
SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'CONFLICTS', 'TYPICAL'));

PROMPT
PROMPT ===== C) Sensitive sites within 50 m: look for DOMAIN INDEX SENS_GEOM_SIDX
EXPLAIN PLAN SET STATEMENT_ID = 'SITES' FOR
SELECT /*+ INDEX(s sens_geom_sidx) */ s.id, s.name
FROM sensitive_sites s
WHERE SDO_WITHIN_DISTANCE(s.geom, SDO_GEOMETRY(:wkt, 4326), 'distance=50 unit=M') = 'TRUE';
SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, 'SITES', 'BASIC'));

EXIT
