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

  // halo: wide soft glow + a corona ring hugging the limb
  float glow = exp(-max(dSun - 1.0, 0.0) * 6.0) * 0.5;
  float corona = exp(-abs(dSun - 1.0) * 9.0) * 0.45 * (0.5 + 0.5 * uObscuration);

  float dMoon = length(p - uMoonOffset);
  float eclipsed = 1.0 - smoothstep(uMoonRadius - aa, uMoonRadius + aa, dMoon);

  // limb-darkened photosphere: warm orange limb -> near-white core
  float limb = smoothstep(1.0, 0.55, dSun);
  vec3 sunColor = mix(vec3(1.0, 0.62, 0.25), vec3(1.0, 0.97, 0.86), limb);
  vec3 moonColor = vec3(0.03, 0.03, 0.08);
  vec3 disc = mix(sunColor, moonColor, eclipsed);

  float discAlpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dSun);
  float glowAmt = glow + corona;
  vec3 glowColor = vec3(1.0, 0.75, 0.45);
  // straight-alpha composite of disc over glow
  vec3 color = (disc * discAlpha + glowColor * glowAmt) / max(discAlpha + glowAmt, 1e-4);
  float alpha = clamp(discAlpha + glowAmt, 0.0, 1.0);
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
