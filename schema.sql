-- =============================================================================
-- سامانه ثبت فعالیت‌ها (v3.3.0) - اسکیمای پایگاه داده مرکزی Cloudflare D1
-- نکته: این جداول به‌صورت خودکار هنگام اولین اجرا توسط worker.ts نیز ساخته می‌شوند.
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_structure (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  supervisions_json TEXT NOT NULL,
  units_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  supervision TEXT NOT NULL,
  unit TEXT NOT NULL,
  is_super_admin INTEGER NOT NULL DEFAULT 0,
  permissions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  asset TEXT NOT NULL,
  rebuildable TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  supervision TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  imported_from_excel INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personnel_overrides (
  code TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  name TEXT NOT NULL,
  national_id TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  management TEXT NOT NULL DEFAULT '',
  supervision TEXT NOT NULL DEFAULT '',
  service_unit TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graphs (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  jalali_date TEXT NOT NULL DEFAULT '',
  jalali_time TEXT NOT NULL DEFAULT '',
  jalali_full TEXT NOT NULL DEFAULT '',
  operator_json TEXT NOT NULL,
  asett TEXT NOT NULL DEFAULT '',
  rebuildable TEXT NOT NULL DEFAULT 'نامشخص',
  report_notes TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL DEFAULT '',
  activities_json TEXT NOT NULL DEFAULT '[]',
  conditional_fields_json TEXT NOT NULL DEFAULT '{}',
  colleagues_json TEXT NOT NULL DEFAULT '[]',
  location_json TEXT NOT NULL DEFAULT '{}',
  duration_hours INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  duration_total_seconds INTEGER NOT NULL DEFAULT 0,
  duration_formatted TEXT NOT NULL DEFAULT '',
  duration_digital TEXT NOT NULL DEFAULT '',
  duration_method TEXT NOT NULL DEFAULT 'دستی',
  sync_status TEXT NOT NULL DEFAULT 'synced',
  synced_at TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graphs_timestamp ON graphs(timestamp DESC);

CREATE TABLE IF NOT EXISTS graph_photos (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  data_url TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_photos_graph_id ON graph_photos(graph_id, sort_order);
