-- Provenance for creative fields + filesystem date columns (Splice enrich).
ALTER TABLE samples ADD COLUMN catalog_source TEXT;
ALTER TABLE samples ADD COLUMN bpm_source TEXT;
ALTER TABLE samples ADD COLUMN key_source TEXT;
ALTER TABLE samples ADD COLUMN sample_type_source TEXT;
ALTER TABLE samples ADD COLUMN date_added_ms BIGINT;
ALTER TABLE samples ADD COLUMN date_created_ms BIGINT;
