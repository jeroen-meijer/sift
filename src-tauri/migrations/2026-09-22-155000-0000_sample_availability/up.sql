-- availability: local | cloud | missing | unknown (Missing flag stays in sync)
ALTER TABLE samples ADD COLUMN availability TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE samples ADD COLUMN availability_checked_at TEXT;

UPDATE samples SET availability = 'missing' WHERE missing != 0;
