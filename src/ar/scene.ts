import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineLoop,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
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

/**
 * The true sun (~0.26° radius) is ~10px on a phone screen — too small to aim
 * at comfortably. Keep a modest display floor (2× the true size instead of the
 * old 12×) and let the concentric reticle rings carry the findability.
 */
export const MIN_SUN_DISPLAY_DEG = 0.5;

/** Finder rings around the sun disc; radii as multiples of the display radius. */
export const RETICLE_RING_MULTIPLIERS = [2, 4, 6] as const;
export const RETICLE_OUTER_MULTIPLIER = RETICLE_RING_MULTIPLIERS[RETICLE_RING_MULTIPLIERS.length - 1];

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

export interface SunBeam {
  group: Group;
  /** Thick yellow band lying flat on the floor, pointing at the sun's azimuth. */
  floor: Mesh<BufferGeometry, MeshBasicMaterial>;
  /** Thin yellow line rising from the floor edge up to the sun disc. */
  rise: LineSegments;
}

export interface SkyOverlay {
  /** Root group holding all overlay content; re-centered on the camera each frame. */
  root: Group;
  sun: Group;
  crescent: Mesh<PlaneGeometry, ShaderMaterial>;
  /** Concentric finder rings (scope reticle) around the sun disc. */
  reticle: LineLoop[];
  horizon: LineLoop;
  grid: LineLoop[];
  bearings: Group;
  floor: Mesh<CircleGeometry, MeshBasicMaterial>;
  beam: SunBeam;
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
 * cardinal bearings, floor guide) into the engine's main three.js scene. The
 * overlay renders over the full camera feed, so real occluders (buildings,
 * trees) visibly hide the sun disc when they lie between the user and the
 * eclipse position.
 *
 * Everything hangs under a single `root` group so the controller can keep the
 * whole overlay centered on the camera (phone) each frame: the eclipse position
 * is a direction from the observer, not a fixed point in the room, so the dome
 * must translate with the phone instead of staying anchored in world space.
 */
export function createSkyOverlay(scene: Scene): SkyOverlay {
  const root = new Group();
  root.name = 'sky-overlay';
  scene.add(root);

  const sun = new Group();
  sun.name = 'sun';
  const crescent = new Mesh(new PlaneGeometry(2, 2), createCrescentMaterial());
  sun.add(crescent);
  const reticle = buildReticle();
  for (const ring of reticle) {
    sun.add(ring);
  }
  root.add(sun);

  const horizon = buildHorizonRing();
  root.add(horizon);

  const grid = buildAltitudeGrid();
  for (const ring of grid) {
    root.add(ring);
  }

  const bearings = buildBearings();
  root.add(bearings);

  const floor = buildFloor();
  root.add(floor);

  const beam = buildSunBeam();
  root.add(beam.group);

  return {
    root,
    sun,
    crescent,
    reticle,
    horizon,
    grid,
    bearings,
    floor,
    beam,
    dispose: () => {
      disposeGeometry(crescent.geometry);
      reticle.forEach((ring) => {
        disposeGeometry(ring.geometry);
        (ring.material as LineBasicMaterial).dispose();
      });
      disposeGeometry(horizon.geometry);
      grid.forEach((ring) => disposeGeometry(ring.geometry));
      bearings.traverse((obj) => {
        if (obj instanceof LineSegments || obj instanceof Mesh) {
          disposeGeometry(obj.geometry);
          (obj.material as { dispose?: () => void } | undefined)?.dispose?.();
        }
      });
      disposeGeometry(floor.geometry);
      disposeGeometry(beam.floor.geometry);
      disposeGeometry(beam.rise.geometry);
      crescent.material.dispose();
      floor.material.dispose();
      beam.floor.material.dispose();
      (beam.rise.material as LineBasicMaterial).dispose();
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
  overlay.reticle.forEach((ring, i) => {
    ring.scale.setScalar(Math.max(worldRadius, 1e-6) * RETICLE_RING_MULTIPLIERS[i]);
  });

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

  placeSunBeam(overlay.beam, overlay.sun.position, placedAzimuth);
}

const RETICLE_COLOR = 0xffffff;

/**
 * Concentric finder rings around the sun disc — a scope reticle. Each is a
 * unit-radius circle in the disc's own plane (z = 0), scaled to a multiple of
 * the display radius in `setupSkyOverlay`. They share the sun group's
 * position and world-anchored orientation, so they stay centered on the disc
 * as the phone rotates.
 */
function buildReticle(): LineLoop[] {
  const rings: LineLoop[] = [];
  for (let ring = 0; ring < RETICLE_RING_MULTIPLIERS.length; ring += 1) {
    const geometry = new BufferGeometry();
    const positions: number[] = [];
    const segments = 64;
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(angle), Math.sin(angle), 0);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    rings.push(
      new LineLoop(
        geometry,
        new LineBasicMaterial({
          color: RETICLE_COLOR,
          transparent: true,
          opacity: ring === 0 ? 0.45 : 0.3,
          depthWrite: false,
        }),
      ),
    );
  }
  return rings;
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

/**
 * A large translucent disc lying flat on the ground, so the horizon ring and
 * compass ticks have a visible "floor" to read against rather than floating
 * over the camera feed. Flat shading, no occlusion, subtle enough not to hide
 * real occluders (buildings, trees) that should mask the sun.
 */
function buildFloor(): Mesh<CircleGeometry, MeshBasicMaterial> {
  const geometry = new CircleGeometry(SUN_DISTANCE, 64);
  const material = new MeshBasicMaterial({
    color: 0x1b2436,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
    side: DoubleSide,
  });
  const floor = new Mesh(geometry, material);
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = GROUND_Y;
  return floor;
}

const BEAM_COLOR = 0xffd400;
/** World-space half-width of the thick floor band. */
const BEAM_HALF_WIDTH = 0.3;
/**
 * The virtual ground sits below the camera's eye level (the camera starts at
 * world y=0), so the floor disc and beam are visible as a floor guide when the
 * user looks down — a flat line drawn at y=0 would be edge-on and invisible.
 */
const GROUND_Y = -2;

/**
 * The "sight line" that guides the eye from the user up to the eclipse: a
 * thick yellow band lying flat on the floor pointing at the sun's azimuth, plus
 * a thin yellow line rising from the ring edge up to the sun disc. Geometries
 * are allocated once and their position attributes rewritten each frame.
 */
function buildSunBeam(): SunBeam {
  const group = new Group();
  group.name = 'sun-beam';

  const floorGeometry = new BufferGeometry();
  floorGeometry.setAttribute('position', new Float32BufferAttribute(new Array(18).fill(0), 3));
  const floor = new Mesh(
    floorGeometry,
    new MeshBasicMaterial({
      color: BEAM_COLOR,
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  floor.name = 'beam-floor';
  group.add(floor);

  const riseGeometry = new BufferGeometry();
  riseGeometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const rise = new LineSegments(
    riseGeometry,
    new LineBasicMaterial({ color: BEAM_COLOR, transparent: true, opacity: 0.85 }),
  );
  rise.name = 'beam-rise';
  group.add(rise);

  return { group, floor, rise };
}

function placeSunBeam(
  beam: SunBeam,
  sunPosition: { x: number; y: number; z: number },
  placedAzimuth: number,
): void {
  const dir = sunDirectionVector(placedAzimuth, 0);
  // Ring-edge point at the sun's azimuth, on the floor.
  const ex = dir.x * SUN_DISTANCE;
  const ez = dir.z * SUN_DISTANCE;

  // Thick floor band: a quad lying flat on the lowered ground, from the origin
  // to the edge point, offset perpendicular (in the XZ plane) by BEAM_HALF_WIDTH
  // on each side. It sits on GROUND_Y so it reads as a floor guide the user can
  // look down to see, rather than an edge-on line at eye level.
  const px = (-ez / SUN_DISTANCE) * BEAM_HALF_WIDTH;
  const pz = (ex / SUN_DISTANCE) * BEAM_HALF_WIDTH;
  const a = [px, GROUND_Y, pz];
  const b = [-px, GROUND_Y, -pz];
  const c = [ex + px, GROUND_Y, ez + pz];
  const d = [ex - px, GROUND_Y, ez - pz];
  const floorAttr = beam.floor.geometry.getAttribute('position') as Float32BufferAttribute;
  floorAttr.setXYZ(0, a[0], a[1], a[2]);
  floorAttr.setXYZ(1, b[0], b[1], b[2]);
  floorAttr.setXYZ(2, c[0], c[1], c[2]);
  floorAttr.setXYZ(3, a[0], a[1], a[2]);
  floorAttr.setXYZ(4, c[0], c[1], c[2]);
  floorAttr.setXYZ(5, d[0], d[1], d[2]);
  floorAttr.needsUpdate = true;

  // Thin rise line: from the compass ring edge (at the sun's azimuth, y=0) up
  // to the sun disc — directly above the end of the floor band.
  const riseAttr = beam.rise.geometry.getAttribute('position') as Float32BufferAttribute;
  riseAttr.setXYZ(0, ex, 0, ez);
  riseAttr.setXYZ(1, sunPosition.x, sunPosition.y, sunPosition.z);
  riseAttr.needsUpdate = true;
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
  const tickColors: number[] = [];
  const cardinalColor = new Color(0x8fa3c8);
  const regularColor = new Color(0x3a4a6a);
  const northColor = new Color(0xff5252);
  for (let azimuth = 0; azimuth < 360; azimuth += 15) {
    const direction = sunDirectionVector(azimuth, 0);
    const x = direction.x * SUN_DISTANCE;
    const z = direction.z * SUN_DISTANCE;
    // The north tick is long and red so the user can quickly sight the N/E/S/W
    // line-up; the other cardinals are moderately long, the rest short.
    const isNorth = azimuth === 0;
    const isCardinal = azimuth % 45 === 0;
    const len = isNorth ? 2.4 : isCardinal ? 1.2 : 0.7;
    const color = isNorth ? northColor : isCardinal ? cardinalColor : regularColor;
    for (const end of [-len / 2, len / 2]) {
      tickPositions.push(x, end, z);
      tickColors.push(color.r, color.g, color.b);
    }
  }
  const tickGeometry = new BufferGeometry();
  tickGeometry.setAttribute('position', new Float32BufferAttribute(tickPositions, 3));
  tickGeometry.setAttribute('color', new Float32BufferAttribute(tickColors, 3));
  const ticks = new LineSegments(
    tickGeometry,
    new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
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
  // Render each stroke as a filled quad (perpendicular offset by half the
  // weight) so the letters have actual thickness — WebGL ignores lineWidth,
  // so thin line-strokes render as unreadable 1px wires.
  const positions: number[] = [];
  for (let i = 0; i < strokes.length; i += 4) {
    pushStrokeQuad(positions, strokes[i], strokes[i + 1], strokes[i + 2], strokes[i + 3]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: options.color,
      transparent: true,
      opacity: 0.95,
      side: DoubleSide,
    }),
  );
  group.add(mesh);
  return group;
}

const STROKE_WEIGHT = 0.15;

/**
 * Appends two triangles covering the thickened segment from (x0,y0) to
 * (x1,y1) in the letter's normalized coordinate space. The quad is offset
 * perpendicular to the stroke direction by half the weight, then transformed
 * into world-letter space (scale + origin shift, z = 0).
 */
function pushStrokeQuad(positions: number[], x0: number, y0: number, x1: number, y1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = (-dy / len) * (STROKE_WEIGHT / 2);
  const py = (dx / len) * (STROKE_WEIGHT / 2);

  const corners = [
    [x0 + px, y0 + py],
    [x0 - px, y0 - py],
    [x1 - px, y1 - py],
    [x1 + px, y1 + py],
  ].map(([x, y]) => [(x - 0.3) * LETTER_SIZE, (y - 0.5) * LETTER_SIZE, 0]);

  for (const idx of [
    [0, 1, 2],
    [0, 2, 3],
  ]) {
    for (const i of idx) {
      positions.push(corners[i][0], corners[i][1], corners[i][2]);
    }
  }
}

function disposeGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
}
