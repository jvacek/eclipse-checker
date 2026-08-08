import { LineSegments, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  createSkyOverlay,
  placeSkySun,
  setupSkyOverlay,
  SUN_DISTANCE,
  MIN_SUN_DISPLAY_DEG,
  type SkyOverlay,
} from '../../src/ar/scene';
import { GLOW_EXTENT } from '../../src/ar/crescentShader';

function makeParams(overrides: Partial<Parameters<typeof placeSkySun>[1]> = {}) {
  return {
    azimuthDeg: 180,
    altitudeDeg: 30,
    yawOffsetDeg: 0,
    latitudeDeg: 40,
    rSunDeg: 0.26,
    rMoonDeg: 0.27,
    separationDeg: 0.13,
    positionAngleDeg: 90,
    obscuration: 0.5,
    ...overrides,
  };
}

describe('createSkyOverlay', () => {
  it('adds the sun, horizon, grid and bearings to the given scene', () => {
    const scene = new Scene();
    const overlay: SkyOverlay = createSkyOverlay(scene);
    expect(scene.children).toContain(overlay.sun);
    expect(scene.children).toContain(overlay.horizon);
    expect(overlay.grid).toHaveLength(5);
    expect(overlay.bearings.children).toHaveLength(5);
    overlay.dispose();
  });

  it('builds a compass ring of 15°-tick line segments plus four cardinal letter groups', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    const ticks = overlay.bearings.getObjectByName('bearing-ticks');
    expect(ticks).toBeInstanceOf(LineSegments);
    for (const name of ['bearing-N', 'bearing-E', 'bearing-S', 'bearing-W']) {
      expect(overlay.bearings.getObjectByName(name)).toBeTruthy();
    }
    overlay.dispose();
  });
});

describe('bearing ring compass alignment', () => {
  const DEG_TO_RAD = Math.PI / 180;
  const worldAzimuthOf = (pos: Vector3): number =>
    ((Math.atan2(pos.x, -pos.z) * 180) / Math.PI + 360) % 360;

  it('rotates the ring by +yawOffset so N points at compass north', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    // Sun at compass 90 with yaw 90 → placed at world azimuth 0 (the -Z axis).
    placeSkySun(overlay, makeParams({ azimuthDeg: 90, altitudeDeg: 0, yawOffsetDeg: 90 }));
    expect(worldAzimuthOf(overlay.sun.position)).toBeCloseTo(0, 5);

    // N is built at world azimuth 0; after a +90° yaw it must land at world
    // azimuth 270 (= −90), which is where compass north sits when the sun at
    // compass east is on the −Z axis.
    expect(overlay.bearings.rotation.y).toBeCloseTo(90 * DEG_TO_RAD, 6);
    const n = overlay.bearings.getObjectByName('bearing-N')!;
    const nWorld = n.getWorldPosition(new Vector3());
    expect(worldAzimuthOf(nWorld)).toBeCloseTo(270, 5);
    overlay.dispose();
  });

  it('keeps the ring world-aligned when the yaw offset is zero', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams({ azimuthDeg: 180, altitudeDeg: 30, yawOffsetDeg: 0 }));
    expect(overlay.bearings.rotation.y).toBe(0);
    const n = overlay.bearings.getObjectByName('bearing-N')!;
    expect(worldAzimuthOf(n.getWorldPosition(new Vector3()))).toBeCloseTo(0, 5);
    overlay.dispose();
  });

  it('re-rotates the ring when the yaw offset changes (recalibrate)', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams({ yawOffsetDeg: 30 }));
    expect(overlay.bearings.rotation.y).toBeCloseTo(30 * DEG_TO_RAD, 6);
    placeSkySun(overlay, makeParams({ yawOffsetDeg: 150 }));
    expect(overlay.bearings.rotation.y).toBeCloseTo(150 * DEG_TO_RAD, 6);
    overlay.dispose();
  });
});

describe('placeSkySun', () => {
  it('places the sun at the north-aligned azimuth and altitude', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams());
    expect(overlay.sun.position.x).toBeCloseTo(0, 5);
    expect(overlay.sun.position.z).toBeCloseTo(SUN_DISTANCE * Math.cos((30 * Math.PI) / 180), 5);
    expect(overlay.sun.position.y).toBeCloseTo(SUN_DISTANCE * Math.sin((30 * Math.PI) / 180), 5);
    overlay.dispose();
  });

  it('applies the yaw offset for a north-aligned world', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams({ azimuthDeg: 90, altitudeDeg: 0, yawOffsetDeg: 90 }));
    expect(overlay.sun.position.x).toBeCloseTo(0, 5);
    expect(overlay.sun.position.z).toBeCloseTo(-SUN_DISTANCE, 5);
    overlay.dispose();
  });

  it('sets the crescent material uniforms for the eclipse shape', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    setupSkyOverlay(overlay, makeParams({ azimuthDeg: 90, altitudeDeg: 45, obscuration: 0.6 }));
    const uniforms = overlay.crescent.material.uniforms as unknown as {
      uMoonOffset: { value: [number, number] };
      uMoonRadius: { value: number };
      uObscuration: { value: number };
    };
    // positionAngleDeg 90 = celestial east, rendered at the observer's left.
    expect(uniforms.uMoonOffset.value[0]).toBeCloseTo(-0.5, 4);
    expect(uniforms.uMoonRadius.value).toBeCloseTo(0.27 / 0.26, 4);
    expect(uniforms.uObscuration.value).toBe(0.6);
    overlay.dispose();
  });

  it('world-anchors the sun disc so its +Z faces the observer', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams({ azimuthDeg: 180, altitudeDeg: 30, yawOffsetDeg: 0 }));
    // Local +Z of the group must point back at the camera (the origin): the
    // opposite of the sun's position direction.
    const z = new Vector3(0, 0, 1).applyQuaternion(overlay.sun.quaternion);
    const dir = overlay.sun.position.clone().normalize();
    expect(z.x).toBeCloseTo(-dir.x, 4);
    expect(z.y).toBeCloseTo(-dir.y, 4);
    expect(z.z).toBeCloseTo(-dir.z, 4);
    overlay.dispose();
  });

  it('enforces a minimum display size so the true-scale sun stays visible', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    setupSkyOverlay(overlay, makeParams({ rSunDeg: 0.26 }));
    expect(overlay.crescent.scale.x).toBeCloseTo(
      SUN_DISTANCE * Math.tan(MIN_SUN_DISPLAY_DEG * (Math.PI / 180)) * GLOW_EXTENT,
      6,
    );
    overlay.dispose();
  });

  it('scales the crescent with the sun radius above the display floor', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    setupSkyOverlay(overlay, makeParams({ rSunDeg: 6 }));
    expect(overlay.crescent.scale.x).toBeCloseTo(
      SUN_DISTANCE * Math.tan(6 * (Math.PI / 180)) * GLOW_EXTENT,
      6,
    );
    overlay.dispose();
  });
});
