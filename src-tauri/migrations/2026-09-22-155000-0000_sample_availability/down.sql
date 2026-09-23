-- SQLite cannot cheaply drop columns; leave availability columns in place on downgrade.
SELECT 1;
