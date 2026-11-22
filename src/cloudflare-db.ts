// ============================================================================
// Cloudflare D1 Backend Bridge (Replaces Firebase & Local Browser Storage)
// سامانه ثبت فعالیت‌ها - نسخه 3.3.0
// ============================================================================

export interface CloudPermissions {
  orgManage: boolean;
  adminManage: boolean;
  backup: boolean;
  personnelManage: boolean;
  assetRebuildable: boolean;
}

export interface CloudAdminRecord {
  username: string;
  fullName: string;
  password?: string;
  supervision: string;
  unit: string;
  isSuperAdmin: boolean;
  permissions: CloudPermissions;
}

export interface OrgUnit {
  name: string;
  supervision: string;
}

export interface OrgStructureData {
  version: string;
  supervisions: string[];
  units: OrgUnit[];
}

export interface AssetItem {
  id: string;
  asset: string;
  rebuildable: string;
  description: string;
  supervision: string;
  unit: string;
  createdAt?: string;
  importedFromExcel?: boolean;
}

export interface PersonnelOverrideDoc {
  code: string;
  action: 'upsert' | 'delete';
  name: string;
  nationalId?: string;
  mobile?: string;
  management?: string;
  supervision?: string;
  serviceUnit?: string;
  jobTitle?: string;
}

const ORG_STRUCTURE_VERSION = 'v3_telecom_tech_workshops';
const ADMIN_TOKEN_KEY = 'cf_admin_token';

const DEFAULT_SUPERVISIONS: string[] = [
  'سرپرستی مخابرات',
  'سرپرستی خدمات فنی',
  'سرپرستی اتوماسیون کارگاه ها',
];

const DEFAULT_UNITS: OrgUnit[] = [
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

const cloudCache = {
  ready: false,
  d1Connected: false,
  d1ErrorCode: '' as string,
  d1Error: '' as string,
  adminSignedIn: false,
  adminProfile: null as CloudAdminRecord | null,
  graphs: [] as Array<Record<string, unknown>>,
  admins: [] as CloudAdminRecord[],
  orgStructure: {
    version: ORG_STRUCTURE_VERSION,
    supervisions: [...DEFAULT_SUPERVISIONS],
    units: [...DEFAULT_UNITS],
  } as OrgStructureData,
  assets: [] as AssetItem[],
  personnelOverrides: [] as PersonnelOverrideDoc[],
  operatorProfile: null as Record<string, unknown> | null,
};

function notifyUI(reason: string) {
  const w = window as unknown as Record<string, unknown>;
  if (typeof w.onCloudStateSync === 'function') {
    try {
      (w.onCloudStateSync as (r: string) => void)(reason);
    } catch (e) {
      console.warn('onCloudStateSync note:', e);
    }
  }
  window.dispatchEvent(new CustomEvent('cloudDataUpdated', { detail: { reason } }));
}

function getToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setToken(token: string) {
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // ignore storage errors
  }
}

async function apiFetch<T = Record<string, unknown>>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(path, {
    ...options,
    headers,
    cache: 'no-store',
  });

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('application/json')) {
    const err = new Error('سرویس API کلادفلر در این محیط فعال نیست');
    (err as unknown as { code?: string }).code = 'WORKER_INACTIVE';
    throw err;
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.ok === false) {
    const err = new Error(String(data.error || `HTTP ${res.status}`));
    (err as unknown as { code?: string; status?: number }).code = String(data.code || '');
    (err as unknown as { status?: number }).status = res.status;
    throw err;
  }

  return data as T;
}

export async function refreshBootstrap(): Promise<boolean> {
  try {
    await apiFetch('/api/health');
    cloudCache.d1Connected = true;
    cloudCache.d1ErrorCode = '';
    cloudCache.d1Error = '';

    const boot = await apiFetch<{
      orgStructure?: OrgStructureData;
      assets?: AssetItem[];
      personnelOverrides?: PersonnelOverrideDoc[];
    }>('/api/bootstrap');

    if (boot.orgStructure) {
      cloudCache.orgStructure = {
        version: boot.orgStructure.version || ORG_STRUCTURE_VERSION,
        supervisions: Array.isArray(boot.orgStructure.supervisions)
          ? boot.orgStructure.supervisions
          : [...DEFAULT_SUPERVISIONS],
        units: Array.isArray(boot.orgStructure.units)
          ? boot.orgStructure.units
          : [...DEFAULT_UNITS],
      };
      notifyUI('orgStructure');
    }

    if (Array.isArray(boot.assets)) {
      cloudCache.assets = boot.assets;
      notifyUI('assets');
    }

    if (Array.isArray(boot.personnelOverrides)) {
      cloudCache.personnelOverrides = boot.personnelOverrides;
      notifyUI('personnelOverrides');
    }

    cloudCache.ready = true;
    notifyUI('status');
    return true;
  } catch (err) {
    const e = err as Error & { code?: string };
    cloudCache.ready = true;
    cloudCache.d1Connected = false;
    cloudCache.d1ErrorCode = e.code || 'CONNECTION_ERROR';
    cloudCache.d1Error = e.message || 'خطا در اتصال به پایگاه داده کلادفلر';
    notifyUI('status');
    return false;
  }
}

async function restoreAdminSession() {
  const token = getToken();
  if (!token) return;
  try {
    const res = await apiFetch<{ admin: CloudAdminRecord }>('/api/auth/me');
    if (res.admin) {
      cloudCache.adminSignedIn = true;
      cloudCache.adminProfile = res.admin;
      notifyUI('adminSignedIn');
    }
  } catch {
    setToken('');
    cloudCache.adminSignedIn = false;
    cloudCache.adminProfile = null;
  }
}

export async function adminLogin(username: string, password: string): Promise<CloudAdminRecord> {
  const res = await apiFetch<{ token: string; admin: CloudAdminRecord }>('/api/auth/admin-login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(res.token);
  cloudCache.adminSignedIn = true;
  cloudCache.adminProfile = res.admin;
  cloudCache.d1Connected = true;
  await refreshBootstrap();
  notifyUI('adminSignedIn');
  return res.admin;
}

export async function adminLogout(): Promise<void> {
  setToken('');
  cloudCache.adminSignedIn = false;
  cloudCache.adminProfile = null;
  cloudCache.graphs = [];
  cloudCache.admins = [];
  notifyUI('adminSignedOut');
}

export async function saveUserOperatorProfile(profile: Record<string, unknown>): Promise<void> {
  cloudCache.operatorProfile = { ...profile };
  try {
    sessionStorage.setItem('automation_operator_profile', JSON.stringify(profile));
  } catch {
    // ignore
  }
}

export async function clearUserOperatorProfile(): Promise<void> {
  cloudCache.operatorProfile = null;
  try {
    sessionStorage.removeItem('automation_operator_profile');
  } catch {
    // ignore
  }
}

export async function verifyPersonnelOverride(
  code: string,
  nationalId: string
): Promise<{
  found: boolean;
  deleted?: boolean;
  matched?: boolean;
  record?: Record<string, string>;
}> {
  return apiFetch('/api/personnel/verify', {
    method: 'POST',
    body: JSON.stringify({ code, nationalId }),
  });
}

// --- Graphs & Photos ---
export async function saveGraphRecord(record: Record<string, unknown>): Promise<string> {
  const res = await apiFetch<{ id: string }>('/api/graphs', {
    method: 'POST',
    body: JSON.stringify(record),
  });
  return res.id;
}

export async function getAllGraphRecords(): Promise<Array<Record<string, unknown>>> {
  const res = await apiFetch<{ records: Array<Record<string, unknown>> }>('/api/graphs');
  cloudCache.graphs = Array.isArray(res.records) ? res.records : [];
  return [...cloudCache.graphs];
}

export async function updateGraphRecord(record: Record<string, unknown>): Promise<string> {
  const id = String(record.id || '').trim();
  if (!id) return saveGraphRecord(record);
  await apiFetch(`/api/graphs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });
  return id;
}

export async function deleteGraphRecord(id: string | number): Promise<void> {
  await apiFetch(`/api/graphs/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
  });
}

// --- Organization Structure ---
export function getOrgStructure(): OrgStructureData {
  return {
    version: cloudCache.orgStructure.version,
    supervisions: [...cloudCache.orgStructure.supervisions],
    units: cloudCache.orgStructure.units.map((u) => ({ ...u })),
  };
}

export async function saveOrgStructure(data: Partial<OrgStructureData>): Promise<void> {
  const res = await apiFetch<{ supervisions: string[]; units: OrgUnit[] }>('/api/org-structure', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  cloudCache.orgStructure = {
    version: data.version || ORG_STRUCTURE_VERSION,
    supervisions: res.supervisions || [],
    units: res.units || [],
  };
  notifyUI('orgStructure');
}

// --- Assets & Rebuildables ---
export async function getAllAssetCatalogItems(): Promise<AssetItem[]> {
  const res = await apiFetch<{ items: AssetItem[] }>('/api/assets');
  cloudCache.assets = Array.isArray(res.items) ? res.items : [];
  return [...cloudCache.assets];
}

export async function saveAssetRebuildableRecord(record: Partial<AssetItem>): Promise<string> {
  const res = await apiFetch<{ id: string }>('/api/assets', {
    method: 'POST',
    body: JSON.stringify({ record }),
  });
  await getAllAssetCatalogItems();
  return res.id;
}

export async function saveMultipleAssetRebuildables(records: Array<Partial<AssetItem>>): Promise<void> {
  await apiFetch('/api/assets', {
    method: 'POST',
    body: JSON.stringify({ items: records }),
  });
  await getAllAssetCatalogItems();
}

export async function deleteAssetRebuildableRecord(id: string | number): Promise<void> {
  await apiFetch(`/api/assets/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
  });
  cloudCache.assets = cloudCache.assets.filter((a) => String(a.id) !== String(id));
}

// --- Admins Registry ---
export async function getAdminsList(): Promise<CloudAdminRecord[]> {
  const res = await apiFetch<{ admins: CloudAdminRecord[] }>('/api/admins');
  cloudCache.admins = Array.isArray(res.admins) ? res.admins : [];
  return [...cloudCache.admins];
}

export async function saveAdminUser(admin: Partial<CloudAdminRecord>): Promise<void> {
  await apiFetch('/api/admins', {
    method: 'POST',
    body: JSON.stringify(admin),
  });
  await getAdminsList();
}

export async function deleteAdminUser(username: string): Promise<void> {
  await apiFetch(`/api/admins/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  });
  cloudCache.admins = cloudCache.admins.filter((a) => a.username !== username);
}

// --- Personnel Overrides ---
export async function savePersonnelOverride(
  record: Partial<PersonnelOverrideDoc>,
  action: 'upsert' | 'delete' = 'upsert'
): Promise<void> {
  await apiFetch('/api/personnel-overrides', {
    method: 'POST',
    body: JSON.stringify({ record, action }),
  });
  await refreshBootstrap();
}

export async function resetPersonnelOverrides(): Promise<void> {
  await apiFetch('/api/personnel-overrides', {
    method: 'DELETE',
  });
  cloudCache.personnelOverrides = [];
  notifyUI('personnelOverrides');
}

// --- Full Backup ---
export async function exportFullBackup(): Promise<Record<string, unknown>> {
  return apiFetch('/api/backup');
}

export const CloudDB = {
  getState: () => ({
    ready: cloudCache.ready,
    d1Connected: cloudCache.d1Connected,
    d1ErrorCode: cloudCache.d1ErrorCode,
    d1Error: cloudCache.d1Error,
    signedIn: cloudCache.d1Connected,
    adminSignedIn: cloudCache.adminSignedIn,
    adminProfile: cloudCache.adminProfile,
    operatorProfile: cloudCache.operatorProfile,
    graphs: [...cloudCache.graphs],
    admins: [...cloudCache.admins],
    orgStructure: getOrgStructure(),
    assets: [...cloudCache.assets],
    personnelOverrides: [...cloudCache.personnelOverrides],
  }),
  refreshBootstrap,
  adminLogin,
  adminLogout,
  saveUserOperatorProfile,
  clearUserOperatorProfile,
  verifyPersonnelOverride,
  saveGraphRecord,
  getAllGraphRecords,
  updateGraphRecord,
  deleteGraphRecord,
  getOrgStructure,
  saveOrgStructure,
  getAllAssetCatalogItems,
  saveAssetRebuildableRecord,
  saveMultipleAssetRebuildables,
  deleteAssetRebuildableRecord,
  getAdminsList,
  saveAdminUser,
  deleteAdminUser,
  savePersonnelOverride,
  resetPersonnelOverrides,
  exportFullBackup,
};

declare global {
  interface Window {
    CloudDB: typeof CloudDB;
  }
}

window.CloudDB = CloudDB;

void (async () => {
  await restoreAdminSession();
  await refreshBootstrap();
})();
