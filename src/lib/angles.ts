export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export function normalizeDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}
