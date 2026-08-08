import { Scene } from 'three';
import { describe, expect, it } from 'vitest';

import { createSkyOverlay, placeSkySun, SUN_DISTANCE, type SkyOverlay } from '../../src/ar/scene';

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
    expect(overlay.bearings.children).toHaveLength(4);
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
});
