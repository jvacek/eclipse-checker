import { LineSegments, Scene } from 'three';
import { describe, expect, it } from 'vitest';

import {
  createSkyOverlay,
  placeSkySun,
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
    placeSkySun(overlay, makeParams({ azimuthDeg: 90, altitudeDeg: 45, obscuration: 0.6 }));
    const uniforms = overlay.crescent.material.uniforms as unknown as {
      uMoonOffset: { value: [number, number] };
      uMoonRadius: { value: number };
      uObscuration: { value: number };
    };
    expect(uniforms.uMoonOffset.value[0]).toBeCloseTo(0.5, 4);
    expect(uniforms.uMoonRadius.value).toBeCloseTo(0.27 / 0.26, 4);
    expect(uniforms.uObscuration.value).toBe(0.6);
    overlay.dispose();
  });

  it('enforces a minimum display size so the true-scale sun stays visible', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams({ rSunDeg: 0.26 }));
    expect(overlay.crescent.scale.x).toBeCloseTo(
      SUN_DISTANCE * Math.tan(MIN_SUN_DISPLAY_DEG * (Math.PI / 180)) * GLOW_EXTENT,
      6,
    );
    overlay.dispose();
  });

  it('scales the crescent with the sun radius above the display floor', () => {
    const scene = new Scene();
    const overlay = createSkyOverlay(scene);
    placeSkySun(overlay, makeParams({ rSunDeg: 6 }));
    expect(overlay.crescent.scale.x).toBeCloseTo(
      SUN_DISTANCE * Math.tan(6 * (Math.PI / 180)) * GLOW_EXTENT,
      6,
    );
    overlay.dispose();
  });
});
