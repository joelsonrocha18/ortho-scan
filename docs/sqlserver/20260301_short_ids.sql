/*
  SQL Server migration for friendly short IDs in Arrimo OrthoScan.
  Tables: clinics, dentists, patients, cases, profiles
*/

-- 1) Columns
IF COL_LENGTH('dbo.clinics', 'short_id') IS NULL ALTER TABLE dbo.clinics ADD short_id NVARCHAR(32) NULL;
IF COL_LENGTH('dbo.dentists', 'short_id') IS NULL ALTER TABLE dbo.dentists ADD short_id NVARCHAR(32) NULL;
IF COL_LENGTH('dbo.patients', 'short_id') IS NULL ALTER TABLE dbo.patients ADD short_id NVARCHAR(32) NULL;
IF COL_LENGTH('dbo.cases', 'short_id') IS NULL ALTER TABLE dbo.cases ADD short_id NVARCHAR(48) NULL;
IF COL_LENGTH('dbo.profiles', 'short_id') IS NULL ALTER TABLE dbo.profiles ADD short_id NVARCHAR(48) NULL;

-- 2) Sequences
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_cli_short') CREATE SEQUENCE dbo.seq_cli_short START WITH 1 INCREMENT BY 1;
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_den_short') CREATE SEQUENCE dbo.seq_den_short START WITH 1 INCREMENT BY 1;
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_pac_short') CREATE SEQUENCE dbo.seq_pac_short START WITH 1 INCREMENT BY 1;
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_lab_short') CREATE SEQUENCE dbo.seq_lab_short START WITH 1 INCREMENT BY 1;
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_col_short') CREATE SEQUENCE dbo.seq_col_short START WITH 1 INCREMENT BY 1;
IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'seq_case_short') CREATE SEQUENCE dbo.seq_case_short START WITH 1 INCREMENT BY 1;

-- 3) Backfill
UPDATE dbo.clinics
SET short_id = CONCAT('CLI-', RIGHT(CONCAT('0000', CAST(NEXT VALUE FOR dbo.seq_cli_short AS VARCHAR(8))), 4))
WHERE short_id IS NULL OR LTRIM(RTRIM(short_id)) = '';

UPDATE dbo.dentists
SET short_id = CONCAT('DEN-', RIGHT(CONCAT('0000', CAST(NEXT VALUE FOR dbo.seq_den_short AS VARCHAR(8))), 4))
WHERE short_id IS NULL OR LTRIM(RTRIM(short_id)) = '';

UPDATE dbo.patients
SET short_id = CONCAT('PAC-', RIGHT(CONCAT('0000', CAST(NEXT VALUE FOR dbo.seq_pac_short AS VARCHAR(8))), 4))
WHERE short_id IS NULL OR LTRIM(RTRIM(short_id)) = '';

UPDATE p
SET short_id = CASE
  WHEN p.role = 'lab_tech' THEN CONCAT('LAB-', RIGHT(CONCAT('000', CAST(NEXT VALUE FOR dbo.seq_lab_short AS VARCHAR(8))), 3))
  ELSE CONCAT(
    'COL-',
    COALESCE(REPLACE(c.short_id, '-', ''), 'CLI0000'),
    '-',
    RIGHT(CONCAT('00', CAST(NEXT VALUE FOR dbo.seq_col_short AS VARCHAR(8))), 2)
  )
END
FROM dbo.profiles p
LEFT JOIN dbo.clinics c ON c.id = p.clinic_id
WHERE p.short_id IS NULL OR LTRIM(RTRIM(p.short_id)) = '';

UPDATE cs
SET short_id = CONCAT(
  'CAS-',
  COALESCE(REPLACE(c.short_id, '-', ''), 'CLI0000'),
  '-',
  RIGHT(CONCAT('0000', UPPER(CONVERT(VARCHAR(8), NEXT VALUE FOR dbo.seq_case_short, 16))), 4)
)
FROM dbo.cases cs
LEFT JOIN dbo.clinics c ON c.id = cs.clinic_id
WHERE cs.short_id IS NULL OR LTRIM(RTRIM(cs.short_id)) = '';

-- 4) Unique constraints
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_clinics_short_id')
  CREATE UNIQUE INDEX ux_clinics_short_id ON dbo.clinics(short_id) WHERE short_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_dentists_short_id')
  CREATE UNIQUE INDEX ux_dentists_short_id ON dbo.dentists(short_id) WHERE short_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_patients_short_id')
  CREATE UNIQUE INDEX ux_patients_short_id ON dbo.patients(short_id) WHERE short_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_cases_short_id')
  CREATE UNIQUE INDEX ux_cases_short_id ON dbo.cases(short_id) WHERE short_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_profiles_short_id')
  CREATE UNIQUE INDEX ux_profiles_short_id ON dbo.profiles(short_id) WHERE short_id IS NOT NULL;
