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
    const { xFrac, yFrac } = skyMapPoint(azimuth, 0);
    ctx.fillText(label, xFrac * SIZE, yFrac * SIZE);
  }
}

function drawSun(ctx: CanvasRenderingContext2D, view: EclipseView) {
  const { xFrac, yFrac } = skyMapPoint(view.sunAzimuthPeakDeg, view.sunAltitudePeakDeg);
  const x = xFrac * SIZE;
  const y = yFrac * SIZE;
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
  ctx.fillText(`Sun ${view.times.peak.localTime}`, x, y - 16);
  ctx.textBaseline = 'middle';
}

function drawHeading(ctx: CanvasRenderingContext2D, headingDeg: number) {
  const { xFrac, yFrac } = skyMapPoint(headingDeg, 0);
  const x = xFrac * SIZE;
  const y = yFrac * SIZE;
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath();
  ctx.moveTo(x, y - 10);
  ctx.lineTo(x - 5, y - 20);
  ctx.lineTo(x + 5, y - 20);
  ctx.closePath();
  ctx.fill();
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('you', x, y - 26);
}
