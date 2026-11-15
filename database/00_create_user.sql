-- =====================================================================
-- 00_create_user.sql  —  run ONCE as SYSTEM in the FREEPDB1 pluggable DB
--   sqlplus system@localhost:1521/FREEPDB1 @database/00_create_user.sql
-- SQL*Plus prompts for the new EXCAV password (&excav_password);
-- it is never stored in this file.
-- =====================================================================
SET VERIFY OFF
WHENEVER SQLERROR EXIT SQL.SQLCODE

ACCEPT excav_password CHAR PROMPT 'New password for user EXCAV: ' HIDE

CREATE USER excav IDENTIFIED BY "&excav_password"
  DEFAULT TABLESPACE users QUOTA UNLIMITED ON users;

GRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE, CREATE VIEW, CREATE PROCEDURE TO excav;

PROMPT User EXCAV created.
EXIT
