import { useEffect, useRef } from 'react';

import type { EclipseView } from '../astro';
import { skyMapPoint } from '../lib/skyMap';

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = 140;

interface SkyMapProps {
  view: EclipseView;
  headingDeg: number | null;
}

export function SkyMap({ view, headingDeg }: SkyMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, SIZE, SIZE);
    drawSkyMap(ctx, view, headingDeg);
  }, [view, headingDeg]);

  return <canvas ref={canvasRef} className="sky-map" style={{ width: SIZE, height: SIZE }} />;
}

function drawSkyMap(ctx: CanvasRenderingContext2D, view: EclipseView, headingDeg: number | null) {
  drawHorizon(ctx);
  drawAltitudeRings(ctx);
  drawCardinals(ctx);
  drawSun(ctx, view);
  if (headingDeg !== null) {
    drawHeading(ctx, headingDeg);
  }
}

function point(azimuthDeg: number, altitudeDeg: number): { x: number; y: number } {
  const { xFrac, yFrac } = skyMapPoint(azimuthDeg, altitudeDeg);
  return {
    x: CENTER + (xFrac - 0.5) * 2 * RADIUS,
    y: CENTER + (yFrac - 0.5) * 2 * RADIUS,
  };
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  baseline: CanvasTextBaseline,
) {
  const halfWidth = ctx.measureText(text).width / 2;
  const x = Math.min(Math.max(cx, halfWidth), SIZE - halfWidth);
  const y =
    baseline === 'middle'
      ? Math.min(Math.max(cy, 12), SIZE - 12)
      : Math.min(Math.max(cy, 11), SIZE - 4);
  ctx.fillText(text, x, y);
}

function drawHorizon(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = '#2c3342';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawAltitudeRings(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#1f2633';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const altitude of [30, 60]) {
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RADIUS * (1 - altitude / 90), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

const CARDINALS: Array<{ label: string; azimuth: number }> = [
  { label: 'N', azimuth: 0 },
  { label: 'E', azimuth: 90 },
  { label: 'S', azimuth: 180 },
  { label: 'W', azimuth: 270 },
];

function drawCardinals(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#9aa3b2';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { label, azimuth } of CARDINALS) {
    const { x, y } = point(azimuth, 0);
    drawLabel(ctx, label, x, y, 'middle');
  }
}

function drawSun(ctx: CanvasRenderingContext2D, view: EclipseView) {
  const { x, y } = point(view.sunAzimuthPeakDeg, view.sunAltitudePeakDeg);
  const visible = view.sunAltitudePeakDeg > 0;

  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fillStyle = visible ? '#f5c542' : '#6b7280';
  ctx.globalAlpha = visible ? 0.95 : 0.4;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.strokeStyle = visible ? '#b78a16' : '#4b5563';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#e6e8ee';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const labelY = y - 16 >= 12 ? y - 16 : y + 26;
  drawLabel(ctx, `Sun ${view.times.peak.localTime}`, x, labelY, 'bottom');
}

function drawHeading(ctx: CanvasRenderingContext2D, headingDeg: number) {
  const { x, y } = point(headingDeg, 0);
  const dx = x - CENTER;
  const dy = y - CENTER;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * 14 + px * 6, y - uy * 14 + py * 6);
  ctx.lineTo(x - ux * 14 - px * 6, y - uy * 14 - py * 6);
  ctx.closePath();
  ctx.fill();

  const bearing = Math.round(headingDeg) % 360;
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = '#3b82f6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawLabel(ctx, `facing ${bearing}°`, x - ux * 26, y - uy * 26, 'middle');
}
