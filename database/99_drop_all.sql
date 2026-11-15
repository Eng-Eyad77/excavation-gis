-- =====================================================================
-- 99_drop_all.sql  —  run as EXCAV to reset the schema
--   sqlplus excav@localhost:1521/FREEPDB1 @database/99_drop_all.sql
-- Then re-run 01_schema.sql and 02_seed.sql.
-- Dropping a table also drops its spatial index; metadata rows are removed explicitly.
-- =====================================================================
SET SERVEROUTPUT ON
BEGIN
  FOR t IN (SELECT column_value AS name FROM TABLE(sys.odcivarchar2list(
              'EXCAVATIONS','APP_USERS','SENSITIVE_SITES','PAVED_ROADS','CITY_BOUNDARY','AGENCIES'))) LOOP
    BEGIN
      EXECUTE IMMEDIATE 'DROP TABLE ' || t.name || ' CASCADE CONSTRAINTS PURGE';
      DBMS_OUTPUT.PUT_LINE('Dropped ' || t.name);
    EXCEPTION WHEN OTHERS THEN
      IF SQLCODE != -942 THEN RAISE; END IF;  -- ORA-00942: table does not exist
    END;
  END LOOP;
END;
/
DELETE FROM user_sdo_geom_metadata
 WHERE table_name IN ('EXCAVATIONS','SENSITIVE_SITES','PAVED_ROADS','CITY_BOUNDARY');
COMMIT;
PROMPT All objects dropped.
EXIT
