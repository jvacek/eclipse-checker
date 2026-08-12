const HEMISPHERE_RE = /[NSEWnsew]$/;

const SPLIT_RE = /[°ºd'"′″ms\s]+/;

export function parseCoordinate(input: string): number | null {
  const raw = input.trim().replace(/\s+/g, ' ');
  if (!raw) {
    return null;
  }

  let body = raw;
  let negative = false;
  const last = raw.slice(-1);
  if (HEMISPHERE_RE.test(last)) {
    body = raw.slice(0, -1).trim();
    negative = last === 'S' || last === 's' || last === 'W' || last === 'w';
  }

  const decimal = Number(body);
  if (Number.isFinite(decimal)) {
    return negative ? -Math.abs(decimal) : decimal;
  }

  const parts = body.split(SPLIT_RE).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) {
    return null;
  }
  const nums = parts.map(Number);
  if (!nums.every(Number.isFinite)) {
    return null;
  }
  const [degrees, minutes = 0, seconds = 0] = nums;
  if (minutes >= 60 || seconds >= 60 || minutes < 0 || seconds < 0) {
    return null;
  }
  const magnitude = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  return negative || degrees < 0 ? -magnitude : magnitude;
}

/** Formats a latitude/longitude pair as "65.2°N, 25.2°W" (decimal degrees). */
export function formatLatLon(lat: number, lon: number, precision = 1): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(precision)}°${ns}, ${Math.abs(lon).toFixed(precision)}°${ew}`;
}
