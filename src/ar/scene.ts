import {
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  LineLoop,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
} from 'three';

import { DEG_TO_RAD } from '../astro/constants';
import { applyEclipseDiscGeometry, createCrescentMaterial } from './crescentShader';
import { eclipseDiscGeometry, northAlignedAzimuth, sunDirectionVector } from './math';

export const SUN_DISTANCE = 30;

export interface SunSceneParams {
  azimuthDeg: number;
  altitudeDeg: number;
  yawOffsetDeg: number;
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
      bearings.children.forEach((child) => {
        if (child instanceof Mesh) {
          disposeGeometry(child.geometry);
        }
      });
      crescent.material.dispose();
    },
  };
}

export function placeSkySun(overlay: SkyOverlay, params: SunSceneParams): void {
  const direction = sunDirectionVector(
    northAlignedAzimuth(params.azimuthDeg, params.yawOffsetDeg),
    params.altitudeDeg,
  );
  overlay.sun.position.set(direction.x, direction.y, direction.z).multiplyScalar(SUN_DISTANCE);

  const worldRadius = SUN_DISTANCE * Math.tan(params.rSunDeg * DEG_TO_RAD);
  overlay.crescent.scale.setScalar(Math.max(worldRadius, 1e-6));

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
  for (const azimuth of CARDINALS) {
    const isNorth = azimuth === 0;
    const direction = sunDirectionVector(azimuth, 0);
    const cone = new Mesh(
      new ConeGeometry(0.12, 0.45, 12),
      new MeshBasicMaterial({ color: isNorth ? 0xff6b6b : 0x4a6bd0 }),
    );
    cone.position.set(direction.x, direction.y, direction.z).multiplyScalar(SUN_DISTANCE);
    cone.lookAt(cone.position.x * 2, 0, cone.position.z * 2);
    group.add(cone);
  }
  return group;
}

function disposeGeometry(geometry: BufferGeometry): void {
  geometry.dispose();
}
