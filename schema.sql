-- Cron Monitor Database Schema

CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  grace_seconds INTEGER DEFAULT 60,
  alert_email TEXT,
  alert_webhook TEXT,
  created_at INTEGER NOT NULL,
  last_ping INTEGER,
  status TEXT DEFAULT 'new',
  failure_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  monitor_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  status TEXT DEFAULT 'success',
  FOREIGN KEY (monitor_id) REFERENCES monitors(id)
);

CREATE INDEX IF NOT EXISTS idx_pings_monitor ON pings(monitor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_monitors_status ON monitors(status);
