// =============================================================================
// Cloudflare Worker Backend (Cloudflare D1 Database + Photo Storage + Static Assets)
// سامانه ثبت فعالیت‌ها - نسخه 3.3.0
// =============================================================================

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<{ results?: T[]; success: boolean }>>;
}

interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  DB?: D1Database;
  ASSETS: AssetsFetcher;
}

interface AdminPermissions {
  orgManage: boolean;
  adminManage: boolean;
  backup: boolean;
  personnelManage: boolean;
  assetRebuildable: boolean;
}

interface AdminSession {
  username: string;
  fullName: string;
  supervision: string;
  unit: string;
  isSuperAdmin: boolean;
  permissions: AdminPermissions;
}

const APP_VERSION = '3.3.0';
const ORG_STRUCTURE_VERSION = 'v3_telecom_tech_workshops';

const DEFAULT_SUPERVISIONS = [
  'سرپرستی مخابرات',
  'سرپرستی خدمات فنی',
  'سرپرستی اتوماسیون کارگاه ها',
];

const DEFAULT_UNITS = [
  { name: 'واحد اعلام حریق', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد صوتی و تصویری', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد شبکه مخابرات', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد اسکادا', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد تعمیرگاه مخابرات', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد مراکز تلفن', supervision: 'سرپرستی مخابرات' },
  { name: 'واحد توزین', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد کارگاه مکانیک', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد ابزار دقیق', supervision: 'سرپرستی خدمات فنی' },
  { name: 'واحد ازمایشگاه الکترونیک و کامپیوتر', supervision: 'سرپرستی خدمات فنی' },
  { name: 'اتوماسیون نورد', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون کک سازی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون فولادسازی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون آگلومراسیون', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون نیروگاهها', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون انرژی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
  { name: 'اتوماسیون آبرسانی', supervision: 'سرپرستی اتوماسیون کارگاه ها' },
];

const DEFAULT_ASSETS = [
  {
    id: 'def_41030DEMO_SD14',
    asset: '41030DEMO',
    rebuildable: 'SD#14',
    description: 'دتکتور دوداتاق برق  سرپرستی مخابرات   واحد:واحد اعلام حریق',
    supervision: 'سرپرستی مخابرات',
    unit: 'واحد اعلام حریق',
    createdAt: '2026-09-30T00:00:00.000Z',
    importedFromExcel: false,
  },
  {
    id: 'def_14031DEM0_HD15',
    asset: '14031DEM0',
    rebuildable: 'HD#15',
    description: 'دتکتور حرارت اتاق برق  سرپریتی مخابرات   واحد اعلام حریق',
    supervision: 'سرپرستی مخابرات',
    unit: 'واحد اعلام حریق',
    createdAt: '2026-09-30T00:00:00.000Z',
    importedFromExcel: false,
  },
];

const BUILTIN_SUPER_ADMINS = [
  {
    username: 'admin',
    fullName: 'احسان ابوالقاسمی (مدیر نرم افزار )',
    defaultPass: 'ehsan2559',
    supervision: 'کل سرپرستی‌ها',
    unit: 'کل واحدها',
  },
  {
    username: '417734',
    fullName: 'مهندس محسن جعفری (مدیراتوماسیون و ارتباطات )',
    defaultPass: '3344',
    supervision: 'کل سرپرستی‌ها',
    unit: 'کل واحدها',
  },
  {
    username: '417737',
    fullName: 'مهندس محسن جعفری (مدیراتوماسیون و ارتباطات )',
    defaultPass: '3344',
    supervision: 'کل سرپرستی‌ها',
    unit: 'کل واحدها',
  },
];

let schemaPromise: Promise<void> | null = null;
let cachedAuthSecret: string | null = null;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function sStr(val: unknown, maxLen: number): string {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function sInt(val: unknown, min = 0, max = 999999999): number {
  const n = Math.trunc(Number(val) || 0);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function toEnglishDigits(str: string): string {
  return String(str || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

function makeId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function safeParseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const hex = await sha256Hex(`${salt}:${password}`);
  return `sha256$${salt}$${hex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  if (storedHash.startsWith('sha256$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const actualHex = await sha256Hex(`${salt}:${password}`);
    return actualHex === expectedHex;
  }
  return password === storedHash;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array<ArrayBuffer> {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function signAdminToken(username: string, secret: string): Promise<string> {
  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payloadBytes = new TextEncoder().encode(JSON.stringify({ u: username, exp }));
  const payloadB64 = toBase64Url(payloadBytes);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sigB64 = toBase64Url(new Uint8Array(sigBuf));
  return `${payloadB64}.${sigB64}`;
}

async function verifyTokenUsername(token: string, secret: string): Promise<string | null> {
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sigBytes = fromBase64Url(sigB64);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(payloadB64));
    if (!ok) return null;
    const payloadJson = new TextDecoder().decode(fromBase64Url(payloadB64));
    const parsed = JSON.parse(payloadJson) as { u?: string; exp?: number };
    if (!parsed.u || !parsed.exp || Date.now() > parsed.exp) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

async function ensureDatabaseReady(db: D1Database): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const ddl = [
        `CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS org_structure (id TEXT PRIMARY KEY, version TEXT NOT NULL, supervisions_json TEXT NOT NULL, units_json TEXT NOT NULL, updated_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS admins (username TEXT PRIMARY KEY, full_name TEXT NOT NULL, password_hash TEXT NOT NULL, supervision TEXT NOT NULL, unit TEXT NOT NULL, is_super_admin INTEGER NOT NULL DEFAULT 0, permissions_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, asset TEXT NOT NULL, rebuildable TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', supervision TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', imported_from_excel INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS personnel_overrides (code TEXT PRIMARY KEY, action TEXT NOT NULL, name TEXT NOT NULL, national_id TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '', management TEXT NOT NULL DEFAULT '', supervision TEXT NOT NULL DEFAULT '', service_unit TEXT NOT NULL DEFAULT '', job_title TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS graphs (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, jalali_date TEXT NOT NULL DEFAULT '', jalali_time TEXT NOT NULL DEFAULT '', jalali_full TEXT NOT NULL DEFAULT '', operator_json TEXT NOT NULL, asett TEXT NOT NULL DEFAULT '', rebuildable TEXT NOT NULL DEFAULT 'نامشخص', report_notes TEXT NOT NULL DEFAULT '', activity_type TEXT NOT NULL DEFAULT '', activities_json TEXT NOT NULL DEFAULT '[]', conditional_fields_json TEXT NOT NULL DEFAULT '{}', colleagues_json TEXT NOT NULL DEFAULT '[]', location_json TEXT NOT NULL DEFAULT '{}', duration_hours INTEGER NOT NULL DEFAULT 0, duration_minutes INTEGER NOT NULL DEFAULT 0, duration_seconds INTEGER NOT NULL DEFAULT 0, duration_total_seconds INTEGER NOT NULL DEFAULT 0, duration_formatted TEXT NOT NULL DEFAULT '', duration_digital TEXT NOT NULL DEFAULT '', duration_method TEXT NOT NULL DEFAULT 'دستی', sync_status TEXT NOT NULL DEFAULT 'synced', synced_at TEXT, photo_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_graphs_timestamp ON graphs(timestamp DESC)`,
        `CREATE TABLE IF NOT EXISTS graph_photos (id TEXT PRIMARY KEY, graph_id TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, mime_type TEXT NOT NULL DEFAULT 'image/jpeg', data_url TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_graph_photos_graph_id ON graph_photos(graph_id, sort_order)`,
      ];
      await db.batch(ddl.map((q) => db.prepare(q)));

      const now = new Date().toISOString();

      // 1. Auth HMAC Secret
      const secretRow = await db.prepare(`SELECT value FROM system_config WHERE key = 'auth_secret'`).first<{ value: string }>();
      if (secretRow?.value) {
        cachedAuthSecret = secretRow.value;
      } else {
        const newSecret = `${crypto.randomUUID()}_${crypto.randomUUID()}`;
        await db.prepare(`INSERT OR IGNORE INTO system_config (key, value) VALUES ('auth_secret', ?)`).bind(newSecret).run();
        const check = await db.prepare(`SELECT value FROM system_config WHERE key = 'auth_secret'`).first<{ value: string }>();
        cachedAuthSecret = check?.value || newSecret;
      }

      // 2. Default Org Structure
      const orgRow = await db.prepare(`SELECT id FROM org_structure WHERE id = 'main'`).first<{ id: string }>();
      if (!orgRow) {
        await db
          .prepare(
            `INSERT OR IGNORE INTO org_structure (id, version, supervisions_json, units_json, updated_at) VALUES ('main', ?, ?, ?, ?)`
          )
          .bind(ORG_STRUCTURE_VERSION, JSON.stringify(DEFAULT_SUPERVISIONS), JSON.stringify(DEFAULT_UNITS), now)
          .run();
      }

      // 3. Built-in Super Admins
      const fullPerms: AdminPermissions = {
        orgManage: true,
        adminManage: true,
        backup: true,
        personnelManage: true,
        assetRebuildable: true,
      };
      for (const adm of BUILTIN_SUPER_ADMINS) {
        const existing = await db.prepare(`SELECT username FROM admins WHERE username = ?`).bind(adm.username).first<{ username: string }>();
        if (!existing) {
          const pwHash = await hashPassword(adm.defaultPass);
          await db
            .prepare(
              `INSERT OR IGNORE INTO admins (username, full_name, password_hash, supervision, unit, is_super_admin, permissions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
            )
            .bind(adm.username, adm.fullName, pwHash, adm.supervision, adm.unit, JSON.stringify(fullPerms), now, now)
            .run();
        }
      }

      // 4. Default Asset Catalog (seed once)
      const seededRow = await db.prepare(`SELECT value FROM system_config WHERE key = 'assets_seeded'`).first<{ value: string }>();
      if (!seededRow) {
        const countRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM assets`).first<{ cnt: number }>();
        if ((countRow?.cnt || 0) === 0) {
          const stmts = DEFAULT_ASSETS.map((item) =>
            db
              .prepare(
                `INSERT OR IGNORE INTO assets (id, asset, rebuildable, description, supervision, unit, imported_from_excel, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .bind(
                item.id,
                item.asset,
                item.rebuildable,
                item.description,
                item.supervision,
                item.unit,
                item.importedFromExcel ? 1 : 0,
                item.createdAt
              )
          );
          await db.batch(stmts);
        }
        await db.prepare(`INSERT OR IGNORE INTO system_config (key, value) VALUES ('assets_seeded', '1')`).run();
      }
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function getAuthSecret(db: D1Database): Promise<string> {
  if (cachedAuthSecret) return cachedAuthSecret;
  const row = await db.prepare(`SELECT value FROM system_config WHERE key = 'auth_secret'`).first<{ value: string }>();
  if (row?.value) {
    cachedAuthSecret = row.value;
    return row.value;
  }
  throw new Error('AUTH_SECRET_NOT_READY');
}

function mapAdminRow(row: Record<string, unknown>): AdminSession {
  const perms = safeParseJson<Partial<AdminPermissions>>(row.permissions_json, {});
  const isSuper = Number(row.is_super_admin) === 1 || String(row.username) === 'admin' || String(row.username) === '417734' || String(row.username) === '417737';
  return {
    username: String(row.username || ''),
    fullName: String(row.full_name || row.username || ''),
    supervision: String(row.supervision || 'همه سرپرستی‌ها'),
    unit: String(row.unit || 'همه واحدها'),
    isSuperAdmin: isSuper,
    permissions: {
      orgManage: isSuper || Boolean(perms.orgManage),
      adminManage: isSuper || Boolean(perms.adminManage),
      backup: isSuper || Boolean(perms.backup),
      personnelManage: isSuper || Boolean(perms.personnelManage),
      assetRebuildable: isSuper || perms.assetRebuildable !== false,
    },
  };
}

async function getAuthenticatedAdmin(request: Request, db: D1Database): Promise<AdminSession | null> {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const secret = await getAuthSecret(db);
  const username = await verifyTokenUsername(token, secret);
  if (!username) return null;
  const row = await db.prepare(`SELECT * FROM admins WHERE username = ?`).bind(username.toLowerCase()).first();
  if (!row) return null;
  return mapAdminRow(row);
}

function hasAdminModule(admin: AdminSession | null, moduleKey: keyof AdminPermissions): boolean {
  if (!admin) return false;
  if (admin.isSuperAdmin || admin.username === 'admin' || admin.username === '417734' || admin.username === '417737') {
    return true;
  }
  return Boolean(admin.permissions[moduleKey]);
}

function parseDataUrl(dataUrl: string): { mimeType: string; bytes: Uint8Array<ArrayBuffer> } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const mimeType = match[1] || 'image/jpeg';
  const b64 = match[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return { mimeType, bytes };
}

function mapGraphRow(row: Record<string, unknown>, photoUrls: string[]) {
  return {
    id: String(row.id),
    timestamp: Number(row.timestamp) || 0,
    jalaliDate: String(row.jalali_date || ''),
    jalaliTime: String(row.jalali_time || ''),
    jalaliFull: String(row.jalali_full || ''),
    operator: safeParseJson(row.operator_json, {}),
    asett: String(row.asett || ''),
    rebuildable: String(row.rebuildable || 'نامشخص'),
    reportNotes: String(row.report_notes || ''),
    activityType: String(row.activity_type || ''),
    activities: safeParseJson(row.activities_json, []),
    conditionalFields: safeParseJson(row.conditional_fields_json, {}),
    colleagues: safeParseJson(row.colleagues_json, []),
    location: safeParseJson(row.location_json, {}),
    durationHours: Number(row.duration_hours) || 0,
    durationMinutes: Number(row.duration_minutes) || 0,
    durationSeconds: Number(row.duration_seconds) || 0,
    durationTotalSeconds: Number(row.duration_total_seconds) || 0,
    durationFormatted: String(row.duration_formatted || ''),
    durationDigital: String(row.duration_digital || ''),
    durationMethod: String(row.duration_method || 'دستی'),
    syncStatus: String(row.sync_status || 'synced'),
    syncedAt: row.synced_at ? String(row.synced_at) : null,
    photos: photoUrls,
    photo: photoUrls.length > 0 ? photoUrls[0] : null,
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

async function readGraphsWithPhotoUrls(db: D1Database, includeDataUrls = false) {
  const gRes = await db.prepare(`SELECT * FROM graphs ORDER BY timestamp DESC`).all();
  const pRes = includeDataUrls
    ? await db.prepare(`SELECT id, graph_id, sort_order, data_url FROM graph_photos ORDER BY sort_order ASC`).all()
    : await db.prepare(`SELECT id, graph_id, sort_order FROM graph_photos ORDER BY sort_order ASC`).all();

  const photoMap = new Map<string, string[]>();
  for (const p of pRes.results) {
    const gid = String(p.graph_id);
    const list = photoMap.get(gid) || [];
    list.push(includeDataUrls ? String(p.data_url) : `/api/photos/${encodeURIComponent(String(p.id))}`);
    photoMap.set(gid, list);
  }

  return gRes.results.map((r) => mapGraphRow(r, photoMap.get(String(r.id)) || []));
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        ok: false,
        code: 'D1_NOT_BOUND',
        error: 'دیتابیس کلادفلر (D1 Binding با نام DB) هنوز به این Worker متصل نشده است.',
      },
      503
    );
  }

  const db = env.DB;
  await ensureDatabaseReady(db);

  const path = url.pathname;
  const method = request.method.toUpperCase();

  // 1. Health check
  if (path === '/api/health' && method === 'GET') {
    return json({ ok: true, backend: 'cloudflare-d1', version: APP_VERSION, d1Connected: true });
  }

  // 2. Serve stored photos directly from D1
  if (path.startsWith('/api/photos/') && method === 'GET') {
    const photoId = decodeURIComponent(path.slice('/api/photos/'.length)).trim();
    if (!photoId) return new Response('Not Found', { status: 404 });
    const row = await db
      .prepare(`SELECT mime_type, data_url FROM graph_photos WHERE id = ?`)
      .bind(photoId)
      .first<{ mime_type: string; data_url: string }>();
    if (!row || !row.data_url) return new Response('Not Found', { status: 404 });
    const parsed = parseDataUrl(row.data_url);
    if (!parsed) return new Response('Invalid Image', { status: 500 });
    return new Response(parsed.bytes, {
      status: 200,
      headers: {
        'Content-Type': row.mime_type || parsed.mimeType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  }

  // 3. Bootstrap public catalog + org structure + non-PII personnel directory overrides
  if (path === '/api/bootstrap' && method === 'GET') {
    const orgRow = await db.prepare(`SELECT * FROM org_structure WHERE id = 'main'`).first();
    const assetRows = await db.prepare(`SELECT * FROM assets ORDER BY created_at ASC`).all();
    const admin = await getAuthenticatedAdmin(request, db);
    const canSeeFullPersonnel = hasAdminModule(admin, 'personnelManage');
    const pRows = await db.prepare(`SELECT * FROM personnel_overrides ORDER BY updated_at DESC`).all();

    return json({
      ok: true,
      version: APP_VERSION,
      orgStructure: {
        version: String(orgRow?.version || ORG_STRUCTURE_VERSION),
        supervisions: safeParseJson<string[]>(orgRow?.supervisions_json, [...DEFAULT_SUPERVISIONS]),
        units: safeParseJson<Array<{ name: string; supervision: string }>>(orgRow?.units_json, [...DEFAULT_UNITS]),
      },
      assets: assetRows.results.map((r) => ({
        id: String(r.id),
        asset: String(r.asset || ''),
        rebuildable: String(r.rebuildable || ''),
        description: String(r.description || ''),
        supervision: String(r.supervision || ''),
        unit: String(r.unit || ''),
        importedFromExcel: Number(r.imported_from_excel) === 1,
        createdAt: String(r.created_at || ''),
      })),
      personnelOverrides: pRows.results.map((r) => ({
        code: String(r.code),
        action: String(r.action),
        name: String(r.name),
        nationalId: canSeeFullPersonnel ? String(r.national_id || '') : '',
        mobile: canSeeFullPersonnel ? String(r.mobile || '') : '',
        management: String(r.management || 'مدیریت اتوماسیون و ارتباطات'),
        supervision: String(r.supervision || ''),
        serviceUnit: String(r.service_unit || ''),
        jobTitle: String(r.job_title || ''),
      })),
    });
  }

  // 4. Verify technician personnel credentials against D1 overrides (if added/updated in Admin Panel)
  if (path === '/api/personnel/verify' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { code?: string; nationalId?: string };
    const code = toEnglishDigits(sStr(body.code, 32)).replace(/\D/g, '');
    const nid = toEnglishDigits(sStr(body.nationalId, 20)).replace(/\D/g, '');
    if (!code) return json({ ok: false, error: 'کد پرسنلی نامعتبر است' }, 400);
    const row = await db.prepare(`SELECT * FROM personnel_overrides WHERE code = ?`).bind(code).first();
    if (!row) return json({ ok: true, found: false });
    if (String(row.action) === 'delete') return json({ ok: true, found: true, deleted: true });
    const storedNid = toEnglishDigits(String(row.national_id || '')).replace(/\D/g, '');
    const nidMatch = !storedNid || storedNid === nid;
    if (!nidMatch) return json({ ok: true, found: true, matched: false });
    return json({
      ok: true,
      found: true,
      matched: true,
      record: {
        code: String(row.code),
        name: String(row.name),
        nationalId: storedNid,
        mobile: String(row.mobile || ''),
        management: String(row.management || 'مدیریت اتوماسیون و ارتباطات'),
        supervision: String(row.supervision || ''),
        serviceUnit: String(row.service_unit || ''),
        jobTitle: String(row.job_title || ''),
      },
    });
  }

  // 5. Admin Authentication
  if (path === '/api/auth/admin-login' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = sStr(body.username, 64).toLowerCase();
    const password = String(body.password || '');
    if (!username || !password) {
      return json({ ok: false, error: 'نام کاربری و رمز عبور الزامی است' }, 400);
    }

    const row = await db.prepare(`SELECT * FROM admins WHERE username = ?`).bind(username).first();
    if (!row) {
      return json({ ok: false, error: 'نام کاربری یا رمز عبور نادرست است' }, 401);
    }

    const storedHash = String(row.password_hash || '');
    let valid = await verifyPassword(password, storedHash);
    if (!valid && (username === 'admin' || username === '417734' || username === '417737')) {
      const builtin = BUILTIN_SUPER_ADMINS.find((b) => b.username === username);
      if (builtin && password.toLowerCase() === builtin.defaultPass.toLowerCase() && storedHash === '') {
        valid = true;
      }
    }
    // Case-insensitive match only for legacy 'admin' default password if stored as exact lowercase
    if (!valid && username === 'admin' && password.toLowerCase() === 'ehsan2559') {
      valid = await verifyPassword('ehsan2559', storedHash);
    }

    if (!valid) {
      return json({ ok: false, error: 'نام کاربری یا رمز عبور نادرست است' }, 401);
    }

    const secret = await getAuthSecret(db);
    const token = await signAdminToken(username, secret);
    const admin = mapAdminRow(row);
    return json({ ok: true, token, admin });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!admin) return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
    return json({ ok: true, admin });
  }

  // 6. Graphs (Activity Reports + Photos)
  if (path === '/api/graphs' && method === 'GET') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!admin) return json({ ok: false, error: 'نیاز به ورود مدیر دارید' }, 401);
    const rows = await readGraphsWithPhotoUrls(db, false);
    return json({ ok: true, records: rows });
  }

  if (path === '/api/graphs' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    const id = makeId('graph');

    const rawPhotos = Array.isArray(body.photos)
      ? body.photos
      : body.photo
        ? [body.photo]
        : [];
    const cleanPhotos = rawPhotos
      .map((p) => String(p || '').trim())
      .filter((p) => p.startsWith('data:image/') && p.length <= 1500000)
      .slice(0, 5);

    const rawOp = (body.operator || {}) as Record<string, unknown>;
    const operatorJson = JSON.stringify({
      personnelId: sStr(rawOp.personnelId || rawOp.code || '0', 32),
      firstName: sStr(rawOp.firstName, 80),
      lastName: sStr(rawOp.lastName, 80),
      name: sStr(rawOp.name || `${rawOp.firstName || ''} ${rawOp.lastName || ''}`, 160) || 'اپراتور',
      fatherName: sStr(rawOp.fatherName, 80),
      nationalId: sStr(rawOp.nationalId, 20),
      mobile: sStr(rawOp.mobile, 24),
      management: sStr(rawOp.management || 'مدیریت اتوماسیون و ارتباطات', 160),
      supervision: sStr(rawOp.supervision, 120),
      unit: sStr(rawOp.unit, 120),
      role: sStr(rawOp.role, 160),
    });

    const acts = Array.isArray(body.activities) ? body.activities.slice(0, 30) : [];
    const photoInserts: D1PreparedStatement[] = [];
    const photoUrls: string[] = [];

    cleanPhotos.forEach((dataUrl, idx) => {
      const pid = `${id}_ph_${idx}`;
      const mimeMatch = /^data:([^;]+);base64,/i.exec(dataUrl);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      photoInserts.push(
        db
          .prepare(
            `INSERT INTO graph_photos (id, graph_id, sort_order, mime_type, data_url, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(pid, id, idx, mimeType, dataUrl, dataUrl.length, now)
      );
      photoUrls.push(`/api/photos/${encodeURIComponent(pid)}`);
    });

    const graphInsert = db
      .prepare(
        `INSERT INTO graphs (
          id, timestamp, jalali_date, jalali_time, jalali_full,
          operator_json, asett, rebuildable, report_notes, activity_type,
          activities_json, conditional_fields_json, colleagues_json, location_json,
          duration_hours, duration_minutes, duration_seconds, duration_total_seconds,
          duration_formatted, duration_digital, duration_method,
          sync_status, synced_at, photo_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        Number(body.timestamp) || Date.now(),
        sStr(body.jalaliDate, 32),
        sStr(body.jalaliTime, 32),
        sStr(body.jalaliFull, 120),
        operatorJson,
        sStr(body.asett, 200),
        sStr(body.rebuildable, 200) || 'نامشخص',
        sStr(body.reportNotes, 3000),
        sStr(body.activityType, 500) || 'سایر موارد',
        JSON.stringify(acts),
        JSON.stringify(body.conditionalFields || {}),
        JSON.stringify(Array.isArray(body.colleagues) ? body.colleagues.slice(0, 20) : []),
        JSON.stringify(body.location || {}),
        sInt(body.durationHours, 0, 9999),
        sInt(body.durationMinutes, 0, 59),
        sInt(body.durationSeconds, 0, 59),
        sInt(body.durationTotalSeconds, 0),
        sStr(body.durationFormatted, 120),
        sStr(body.durationDigital, 32),
        sStr(body.durationMethod || 'دستی', 64),
        'synced',
        now,
        photoUrls.length,
        now,
        now
      );

    await db.batch([graphInsert, ...photoInserts]);
    return json({ ok: true, id, photos: photoUrls });
  }

  if (path.startsWith('/api/graphs/') && method === 'PUT') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!admin) return json({ ok: false, error: 'نیاز به ورود مدیر دارید' }, 401);
    const id = decodeURIComponent(path.slice('/api/graphs/'.length)).trim();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date().toISOString();
    await db
      .prepare(`UPDATE graphs SET report_notes = COALESCE(?, report_notes), sync_status = ?, synced_at = ?, updated_at = ? WHERE id = ?`)
      .bind(body.reportNotes !== undefined ? sStr(body.reportNotes, 3000) : null, 'synced', now, now, id)
      .run();
    return json({ ok: true, id });
  }

  if (path.startsWith('/api/graphs/') && method === 'DELETE') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!admin) return json({ ok: false, error: 'نیاز به ورود مدیر دارید' }, 401);
    const id = decodeURIComponent(path.slice('/api/graphs/'.length)).trim();
    await db.batch([
      db.prepare(`DELETE FROM graph_photos WHERE graph_id = ?`).bind(id),
      db.prepare(`DELETE FROM graphs WHERE id = ?`).bind(id),
    ]);
    return json({ ok: true });
  }

  // 7. Organization Structure
  if (path === '/api/org-structure' && method === 'GET') {
    const row = await db.prepare(`SELECT * FROM org_structure WHERE id = 'main'`).first();
    return json({
      ok: true,
      version: String(row?.version || ORG_STRUCTURE_VERSION),
      supervisions: safeParseJson<string[]>(row?.supervisions_json, [...DEFAULT_SUPERVISIONS]),
      units: safeParseJson<Array<{ name: string; supervision: string }>>(row?.units_json, [...DEFAULT_UNITS]),
    });
  }

  if (path === '/api/org-structure' && method === 'PUT') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'orgManage') && !hasAdminModule(admin, 'adminManage')) {
      return json({ ok: false, error: 'عدم دسترسی به مدیریت ساختار سازمانی' }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      version?: string;
      supervisions?: string[];
      units?: Array<{ name?: string; supervision?: string }>;
    };
    const supervisions = (Array.isArray(body.supervisions) ? body.supervisions : [])
      .map((s) => sStr(s, 150))
      .filter(Boolean)
      .slice(0, 200);
    const units = (Array.isArray(body.units) ? body.units : [])
      .map((u) => ({ name: sStr(u?.name, 150), supervision: sStr(u?.supervision, 150) }))
      .filter((u) => u.name.length > 0)
      .slice(0, 500);
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO org_structure (id, version, supervisions_json, units_json, updated_at)
         VALUES ('main', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = excluded.version,
           supervisions_json = excluded.supervisions_json,
           units_json = excluded.units_json,
           updated_at = excluded.updated_at`
      )
      .bind(sStr(body.version || ORG_STRUCTURE_VERSION, 80), JSON.stringify(supervisions), JSON.stringify(units), now)
      .run();

    return json({ ok: true, supervisions, units });
  }

  // 8. Assets & Rebuildables Catalog
  if (path === '/api/assets' && method === 'GET') {
    const res = await db.prepare(`SELECT * FROM assets ORDER BY created_at ASC`).all();
    return json({
      ok: true,
      items: res.results.map((r) => ({
        id: String(r.id),
        asset: String(r.asset || ''),
        rebuildable: String(r.rebuildable || ''),
        description: String(r.description || ''),
        supervision: String(r.supervision || ''),
        unit: String(r.unit || ''),
        importedFromExcel: Number(r.imported_from_excel) === 1,
        createdAt: String(r.created_at || ''),
      })),
    });
  }

  if (path === '/api/assets' && method === 'POST') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'assetRebuildable')) {
      return json({ ok: false, error: 'عدم دسترسی به ماژول asset &Rebuildble' }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      items?: Array<Record<string, unknown>>;
      record?: Record<string, unknown>;
    };
    const rawList = Array.isArray(body.items) ? body.items : body.record ? [body.record] : [];
    if (rawList.length === 0) return json({ ok: false, error: 'رکوردی ارسال نشده است' }, 400);

    const now = new Date().toISOString();
    const savedIds: string[] = [];
    const stmts = rawList.map((r) => {
      const id = sStr(r.id, 128) || makeId('asset');
      savedIds.push(id);
      return db
        .prepare(
          `INSERT INTO assets (id, asset, rebuildable, description, supervision, unit, imported_from_excel, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             asset = excluded.asset,
             rebuildable = excluded.rebuildable,
             description = excluded.description,
             supervision = excluded.supervision,
             unit = excluded.unit,
             imported_from_excel = excluded.imported_from_excel`
        )
        .bind(
          id,
          sStr(r.asset || 'تجهیز نامشخص', 200),
          sStr(r.rebuildable || 'قطعه نامشخص', 200),
          sStr(r.description, 500),
          sStr(r.supervision, 150),
          sStr(r.unit, 150),
          r.importedFromExcel ? 1 : 0,
          sStr(r.createdAt || now, 64)
        );
    });

    for (let i = 0; i < stmts.length; i += 50) {
      await db.batch(stmts.slice(i, i + 50));
    }
    await db.prepare(`INSERT OR IGNORE INTO system_config (key, value) VALUES ('assets_seeded', '1')`).run();
    return json({ ok: true, id: savedIds[0], count: savedIds.length });
  }

  if (path.startsWith('/api/assets/') && method === 'DELETE') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'assetRebuildable')) {
      return json({ ok: false, error: 'عدم دسترسی به حذف قطعه' }, 403);
    }
    const id = decodeURIComponent(path.slice('/api/assets/'.length)).trim();
    await db.prepare(`DELETE FROM assets WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  }

  // 9. Admins Registry
  if (path === '/api/admins' && method === 'GET') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'adminManage')) {
      return json({ ok: false, error: 'عدم دسترسی به فهرست مدیران' }, 403);
    }
    const res = await db.prepare(`SELECT * FROM admins ORDER BY created_at ASC`).all();
    return json({ ok: true, admins: res.results.map(mapAdminRow) });
  }

  if (path === '/api/admins' && method === 'POST') {
    const actor = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(actor, 'adminManage')) {
      return json({ ok: false, error: 'عدم دسترسی به مدیریت مدیران' }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const username = sStr(body.username, 64).toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
    if (!username) return json({ ok: false, error: 'نام کاربری معتبر نیست' }, 400);

    const existing = await db.prepare(`SELECT * FROM admins WHERE username = ?`).bind(username).first();
    const rawPassword = typeof body.password === 'string' ? body.password.trim() : '';

    if (!existing && !rawPassword) {
      return json({ ok: false, error: 'تعیین کلمه عبور برای مدیر جدید الزامی است' }, 400);
    }

    const permsIn = (body.permissions || {}) as Partial<AdminPermissions>;
    const perms: AdminPermissions = {
      orgManage: Boolean(permsIn.orgManage),
      adminManage: Boolean(permsIn.adminManage),
      backup: Boolean(permsIn.backup),
      personnelManage: Boolean(permsIn.personnelManage),
      assetRebuildable: permsIn.assetRebuildable !== false,
    };

    const passwordHash = rawPassword
      ? await hashPassword(rawPassword)
      : String(existing?.password_hash || '');
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO admins (username, full_name, password_hash, supervision, unit, is_super_admin, permissions_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET
           full_name = excluded.full_name,
           password_hash = excluded.password_hash,
           supervision = excluded.supervision,
           unit = excluded.unit,
           permissions_json = excluded.permissions_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        username,
        sStr(body.fullName || username, 160),
        passwordHash,
        sStr(body.supervision || 'همه سرپرستی‌ها', 120),
        sStr(body.unit || 'همه واحدها', 120),
        body.isSuperAdmin ? 1 : 0,
        JSON.stringify(perms),
        now,
        now
      )
      .run();

    return json({ ok: true, username });
  }

  if (path.startsWith('/api/admins/') && method === 'DELETE') {
    const actor = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(actor, 'adminManage')) {
      return json({ ok: false, error: 'عدم دسترسی به حذف مدیر' }, 403);
    }
    const target = decodeURIComponent(path.slice('/api/admins/'.length)).trim().toLowerCase();
    if (target === 'admin' || target === '417734' || target === '417737') {
      return json({ ok: false, error: 'امکان حذف مدیران ارشد سیستم وجود ندارد' }, 400);
    }
    await db.prepare(`DELETE FROM admins WHERE username = ?`).bind(target).run();
    return json({ ok: true });
  }

  // 10. Personnel Overrides
  if (path === '/api/personnel-overrides' && method === 'GET') {
    const admin = await getAuthenticatedAdmin(request, db);
    const canFull = hasAdminModule(admin, 'personnelManage');
    const res = await db.prepare(`SELECT * FROM personnel_overrides ORDER BY updated_at DESC`).all();
    return json({
      ok: true,
      overrides: res.results.map((r) => ({
        code: String(r.code),
        action: String(r.action),
        name: String(r.name),
        nationalId: canFull ? String(r.national_id || '') : '',
        mobile: canFull ? String(r.mobile || '') : '',
        management: String(r.management || 'مدیریت اتوماسیون و ارتباطات'),
        supervision: String(r.supervision || ''),
        serviceUnit: String(r.service_unit || ''),
        jobTitle: String(r.job_title || ''),
      })),
    });
  }

  if (path === '/api/personnel-overrides' && method === 'POST') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'personnelManage')) {
      return json({ ok: false, error: 'عدم دسترسی به مدیریت بانک پرسنل' }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      record?: Record<string, unknown>;
      action?: string;
    };
    const rec = body.record || {};
    const code = toEnglishDigits(sStr(rec.code, 32)).replace(/\D/g, '');
    if (!code) return json({ ok: false, error: 'شماره پرسنلی معتبر نیست' }, 400);
    const action = body.action === 'delete' ? 'delete' : 'upsert';
    const now = new Date().toISOString();

    await db
      .prepare(
        `INSERT INTO personnel_overrides (code, action, name, national_id, mobile, management, supervision, service_unit, job_title, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET
           action = excluded.action,
           name = excluded.name,
           national_id = excluded.national_id,
           mobile = excluded.mobile,
           management = excluded.management,
           supervision = excluded.supervision,
           service_unit = excluded.service_unit,
           job_title = excluded.job_title,
           updated_at = excluded.updated_at`
      )
      .bind(
        code,
        action,
        sStr(rec.name || code, 160),
        toEnglishDigits(sStr(rec.nationalId, 20)).replace(/\D/g, ''),
        toEnglishDigits(sStr(rec.mobile, 24)),
        sStr(rec.management || 'مدیریت اتوماسیون و ارتباطات', 160),
        sStr(rec.supervision, 120),
        sStr(rec.serviceUnit, 120),
        sStr(rec.jobTitle, 160),
        now
      )
      .run();

    return json({ ok: true, code, action });
  }

  if (path === '/api/personnel-overrides' && method === 'DELETE') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'personnelManage')) {
      return json({ ok: false, error: 'عدم دسترسی به بازنشانی بانک پرسنل' }, 403);
    }
    await db.prepare(`DELETE FROM personnel_overrides`).run();
    return json({ ok: true });
  }

  // 11. Full Backup & Restore (with embedded base64 photos from D1)
  if (path === '/api/backup' && method === 'GET') {
    const admin = await getAuthenticatedAdmin(request, db);
    if (!hasAdminModule(admin, 'backup')) {
      return json({ ok: false, error: 'عدم دسترسی به پشتیبان‌گیری' }, 403);
    }
    const graphs = await readGraphsWithPhotoUrls(db, true);
    const adminRes = await db.prepare(`SELECT * FROM admins`).all();
    const orgRow = await db.prepare(`SELECT * FROM org_structure WHERE id = 'main'`).first();
    const assetRes = await db.prepare(`SELECT * FROM assets ORDER BY created_at ASC`).all();
    const pRes = await db.prepare(`SELECT * FROM personnel_overrides`).all();

    return json({
      ok: true,
      exportedAt: new Date().toISOString(),
      version: APP_VERSION,
      data: {
        graphs,
        admins: adminRes.results.map(mapAdminRow),
        orgStructure: {
          version: String(orgRow?.version || ORG_STRUCTURE_VERSION),
          supervisions: safeParseJson<string[]>(orgRow?.supervisions_json, [...DEFAULT_SUPERVISIONS]),
          units: safeParseJson<Array<{ name: string; supervision: string }>>(orgRow?.units_json, [...DEFAULT_UNITS]),
        },
        assetRebuildables: assetRes.results.map((r) => ({
          id: String(r.id),
          asset: String(r.asset || ''),
          rebuildable: String(r.rebuildable || ''),
          description: String(r.description || ''),
          supervision: String(r.supervision || ''),
          unit: String(r.unit || ''),
          importedFromExcel: Number(r.imported_from_excel) === 1,
          createdAt: String(r.created_at || ''),
        })),
        personnelOverrides: pRes.results.map((r) => ({
          code: String(r.code),
          action: String(r.action),
          name: String(r.name),
          nationalId: String(r.national_id || ''),
          mobile: String(r.mobile || ''),
          management: String(r.management || ''),
          supervision: String(r.supervision || ''),
          serviceUnit: String(r.service_unit || ''),
          jobTitle: String(r.job_title || ''),
        })),
      },
    });
  }

  return json({ ok: false, error: 'مسیر API یافت نشد' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        console.error('Worker API error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        return json({ ok: false, error: msg }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
