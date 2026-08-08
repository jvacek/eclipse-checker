import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineLoop,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
} from 'three';

import { DEG_TO_RAD } from '../astro/constants';
import { applyEclipseDiscGeometry, createCrescentMaterial, GLOW_EXTENT } from './crescentShader';
import {
  eclipseDiscGeometry,
  northAlignedAzimuth,
  sunDiscOrientation,
  sunDirectionVector,
} from './math';

export const SUN_DISTANCE = 30;

/** The true sun (~0.26° radius) is ~10px on a phone screen; exaggerate for visibility. */
export const MIN_SUN_DISPLAY_DEG = 3;

export interface SunSceneParams {
  azimuthDeg: number;
  altitudeDeg: number;
  yawOffsetDeg: number;
  latitudeDeg: number;
  rSunDeg: number;
  rMoonDeg: number;
  separationDeg: number;
  positionAngleDeg: number;
  obscuration: number;
}

export interface SkyOverlay {
  sun: Group;
  crescent: Mesh<PlaneGeometry, ShaderMaterial>;
  horizon: LineLoop;
  grid: LineLoop[];
  bearings: Group;
  dispose: () => void;
}

const CARDINALS = [0, 90, 180, 270];
const LETTER_SIZE = 1.6;

const LETTER_STROKES: Record<string, number[]> = {
  N: [0, 0, 0, 1, 0, 1, 0.6, 0, 0.6, 0, 0.6, 1],
  E: [0.6, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0.6, 1, 0, 0.5, 0.42, 0.5],
  S: [0.6, 1, 0, 1, 0, 1, 0, 0.5, 0, 0.5, 0.6, 0.5, 0.6, 0.5, 0.6, 0, 0.6, 0, 0, 0],
  W: [0, 1, 0.15, 0, 0.15, 0, 0.3, 0.55, 0.3, 0.55, 0.45, 0, 0.45, 0, 0.6, 1],
};

/**
 * Builds the eclipse overlay (sun disc + crescent, horizon ring, altitude grid,
 * cardinal bearings) into the engine's main three.js scene. The overlay renders
 * over the full camera feed, so real occluders (buildings, trees) visibly hide
 * the sun disc when they lie between the user and the eclipse position.
 */
export function createSkyOverlay(scene: Scene): SkyOverlay {
  const sun = new Group();
  const crescent = new Mesh(new PlaneGeometry(2, 2), createCrescentMaterial());
  sun.add(crescent);
  scene.add(sun);

  const horizon = buildHorizonRing();
  scene.add(horizon);

  const grid = buildAltitudeGrid();
  for (const ring of grid) {
    scene.add(ring);
  }

  const bearings = buildBearings();
  scene.add(bearings);

  return {
    sun,
    crescent,
    horizon,
    grid,
    bearings,
    dispose: () => {
      disposeGeometry(crescent.geometry);
      disposeGeometry(horizon.geometry);
      grid.forEach((ring) => disposeGeometry(ring.geometry));
      bearings.traverse((obj) => {
        if (obj instanceof LineSegments) {
          disposeGeometry(obj.geometry);
        }
      });
      crescent.material.dispose();
    },
  };
}

/**
 * Applies the session-constant eclipse geometry once (crescent scale, disc
 * shape, obscuration) — these depend only on the fixed sun/moon params, so
 * recomputing them on every rAF tick is wasted work. Call once after
 * `createSkyOverlay`; the per-frame `placeSkySun` then only applies the
 * yaw-dependent transforms.
 */
export function setupSkyOverlay(overlay: SkyOverlay, params: SunSceneParams): void {
  const displayDeg = Math.max(params.rSunDeg, MIN_SUN_DISPLAY_DEG);
  const worldRadius = SUN_DISTANCE * Math.tan(displayDeg * DEG_TO_RAD);
  overlay.crescent.scale.setScalar(Math.max(worldRadius, 1e-6) * GLOW_EXTENT);

  applyEclipseDiscGeometry(
    overlay.crescent.material,
    eclipseDiscGeometry(
      params.rSunDeg,
      params.rMoonDeg,
      params.separationDeg,
      params.positionAngleDeg,
    ),
  );
  overlay.crescent.material.uniforms.uObscuration.value = params.obscuration;
}

export function placeSkySun(overlay: SkyOverlay, params: SunSceneParams): void {
  const placedAzimuth = northAlignedAzimuth(params.azimuthDeg, params.yawOffsetDeg);
  const direction = sunDirectionVector(placedAzimuth, params.altitudeDeg);
  overlay.sun.position.set(direction.x, direction.y, direction.z).multiplyScalar(SUN_DISTANCE);

  // The bearing ring is built in the engine world frame (N at world azimuth 0),
  // but the sun is placed at compass azimuth − yawOffset. Rotate the ring by
  // +yawOffset about Y so N/E/S/W line up with the compass directions the sun
  // is now placed against (N → world azimuth −yawOffset).
  overlay.bearings.rotation.y = params.yawOffsetDeg * DEG_TO_RAD;

  // World-anchor the disc (celestial north up) so the crescent rotates with the
  // sky, not with the phone. +Z faces the observer because the plane sits on
  // the camera→sun ray. The orientation depends on the (re-calibratable) yaw
  // offset, so it stays in the per-frame pass.
  const orientation = sunDiscOrientation(placedAzimuth, params.altitudeDeg, params.latitudeDeg);
  overlay.sun.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
}

function buildHorizonRing(): LineLoop {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  for (let i = 0; i < 64; i += 1) {
    const angle = (i / 64) * Math.PI * 2;
    positions.push(Math.cos(angle) * SUN_DISTANCE, 0, Math.sin(angle) * SUN_DISTANCE);
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new LineLoop(
    geometry,
    new LineBasicMaterial({ color: 0x3a4a6a, transparent: true, opacity: 0.8 }),
  );
}

function buildAltitudeGrid(): LineLoop[] {
  const rings: LineLoop[] = [];
  for (const altitude of [15, 30, 45, 60, 75]) {
    const radius = SUN_DISTANCE * Math.cos(altitude * DEG_TO_RAD);
    const y = SUN_DISTANCE * Math.sin(altitude * DEG_TO_RAD);
    const geometry = new BufferGeometry();
    const positions: number[] = [];
    for (let i = 0; i < 64; i += 1) {
      const angle = (i / 64) * Math.PI * 2;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    rings.push(
      new LineLoop(
        geometry,
        new LineBasicMaterial({ color: 0x26304a, transparent: true, opacity: 0.5 }),
      ),
    );
  }
  return rings;
}

function buildBearings(): Group {
  const group = new Group();

  const tickPositions: number[] = [];
  for (let azimuth = 0; azimuth < 360; azimuth += 15) {
    const direction = sunDirectionVector(azimuth, 0);
    const len = azimuth % 45 === 0 ? 0.8 : 0.45;
    const x = direction.x * SUN_DISTANCE;
    const z = direction.z * SUN_DISTANCE;
    tickPositions.push(x, -len / 2, z, x, len / 2, z);
  }
  const tickGeometry = new BufferGeometry();
  tickGeometry.setAttribute('position', new Float32BufferAttribute(tickPositions, 3));
  const ticks = new LineSegments(
    tickGeometry,
    new LineBasicMaterial({ color: 0x3a4a6a, transparent: true, opacity: 0.8 }),
  );
  ticks.name = 'bearing-ticks';
  group.add(ticks);

  for (const azimuth of CARDINALS) {
    const isNorth = azimuth === 0;
    const direction = sunDirectionVector(azimuth, 0);
    const name = azimuth === 0 ? 'N' : azimuth === 90 ? 'E' : azimuth === 180 ? 'S' : 'W';
    const letter = buildLetter(name, { color: isNorth ? 0xff6b6b : 0x8fa3c8 });
    letter.position.set(direction.x, 0, direction.z).multiplyScalar(SUN_DISTANCE);
    letter.position.y = 1.1;
    letter.lookAt(0, 1.1, 0);
    group.add(letter);
  }

  return group;
}

function buildLetter(letter: string, options: { color: number }): Group {
  const group = new Group();
  group.name = `bearing-${letter}`;
  const strokes = LETTER_STROKES[letter];
  const positions: number[] = [];
  for (let i = 0; i < strokes.length; i += 4) {
    const [x0, y0, x1, y1] = strokes.slice(i, i + 4);
    positions.push(
      (x0 - 0.3) * LETTER_SIZE,
      (y0 - 0.5) * LETTER_SIZE,
      0,
      (x1 - 0.3) * LETTER_SIZE,
      (y1 - 0.5) * LETTER_SIZE,
      0,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const segments = new LineSegments(
    geometry,
    new LineBasicMaterial({ color: options.color, transparent: true, opacity: 0.9 }),
  );
  group.add(segments);
  return group;
}

function disposeGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
}
