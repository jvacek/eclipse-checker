export interface ShareParams {
  lat: number;
  lon: number;
  heightMeters: number;
  eclipseDate?: string;
  kind?: string;
}

export function parseShareParams(search: string): ShareParams | null {
  const params = new URLSearchParams(search);
  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  const lat = latRaw === null ? Number.NaN : Number(latRaw);
  const lon = lonRaw === null ? Number.NaN : Number(lonRaw);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }
  const height = Number(params.get('height'));
  const heightMeters = Number.isFinite(height) && height >= 0 ? height : 0;
  const eclipseDate = params.get('eclipseDate') ?? undefined;
  if (eclipseDate !== undefined && !isValidIsoDate(eclipseDate)) {
    return null;
  }
  const kind = params.get('kind') ?? undefined;
  return { lat, lon, heightMeters, eclipseDate, kind };
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

export function buildShareUrl(base: string, params: ShareParams): string {
  const url = new URL(base);
  url.searchParams.set('lat', params.lat.toFixed(6));
  url.searchParams.set('lon', params.lon.toFixed(6));
  url.searchParams.set('height', String(Math.round(params.heightMeters)));
  if (params.eclipseDate) {
    url.searchParams.set('eclipseDate', params.eclipseDate);
  }
  if (params.kind) {
    url.searchParams.set('kind', params.kind);
  }
  return url.toString();
}
