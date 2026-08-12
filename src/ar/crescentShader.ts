import { ShaderMaterial, type ShaderMaterialParameters } from 'three';

import type { EclipseDiscGeometry } from './math';

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uMoonOffset;
uniform float uMoonRadius;
uniform float uObscuration;
varying vec2 vUv;

const float GLOW_EXTENT = 2.0;

void main() {
  vec2 p = (vUv * 2.0 - 1.0) * GLOW_EXTENT;
  float dSun = length(p);
  // fwidth is WebGL2-only; the 8th Wall AR engine always runs on WebGL2.
  float aa = fwidth(dSun) * 1.5;   // screen-space AA: crisp at any size

  // A near-white photosphere with limb darkening (the real sun is white-hot,
  // dimming to amber only at the extreme edge) reads as an actual eclipse
  // rather than a cartoon orange disc. The subtle warm halo keeps the disc
  // bright against a blue sky without washing out the crescent.
  float limb = smoothstep(1.0, 0.5, dSun);
  vec3 sunColor = mix(vec3(1.0, 0.82, 0.52), vec3(1.0, 0.995, 0.94), limb);
  vec3 moonColor = vec3(0.03, 0.03, 0.08);

  float dMoon = length(p - uMoonOffset);
  float eclipsed = 1.0 - smoothstep(uMoonRadius - aa, uMoonRadius + aa, dMoon);
  vec3 disc = mix(sunColor, moonColor, eclipsed);

  // The corona is only real while the photosphere is almost fully covered:
  // gate it on obscuration so a partial eclipse doesn't glow like a cartoon.
  float corona = exp(-abs(dSun - 1.0) * 7.0) * 0.5 * smoothstep(0.82, 0.98, uObscuration);

  float discAlpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dSun);
  vec3 glowColor = vec3(1.0, 0.95, 0.85);
  // straight-alpha composite of disc over glow
  vec3 color = (disc * discAlpha + glowColor * corona) / max(discAlpha + corona, 1e-4);
  float alpha = clamp(discAlpha + corona, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;

/** The quad spans [-GLOW_EXTENT, GLOW_EXTENT] so the disc (radius 1) has a glow halo. */
export const GLOW_EXTENT = 2.0;

export interface CrescentUniforms {
  uMoonOffset: { value: [number, number] };
  uMoonRadius: { value: number };
  uObscuration: { value: number };
}

export function createCrescentMaterial(options: ShaderMaterialParameters = {}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMoonOffset: { value: [0, 0] },
      uMoonRadius: { value: 0 },
      uObscuration: { value: 0 },
    },
    ...options,
  });
}

export function applyEclipseDiscGeometry(
  material: ShaderMaterial,
  geometry: EclipseDiscGeometry,
): void {
  const uniforms = material.uniforms as unknown as CrescentUniforms;
  uniforms.uMoonOffset.value = [geometry.moonOffsetX, geometry.moonOffsetY];
  uniforms.uMoonRadius.value = geometry.moonRadius;
}
