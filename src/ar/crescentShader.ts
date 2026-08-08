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

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float dSun = length(p);
  if (dSun > 1.0) discard;

  float dMoon = length(p - uMoonOffset);
  float eclipsed = 1.0 - smoothstep(uMoonRadius - 0.015, uMoonRadius + 0.015, dMoon);

  float rim = smoothstep(0.985, 1.0, dSun);
  vec3 sunColor = mix(vec3(1.0, 0.84, 0.5), vec3(1.0, 0.98, 0.85), rim);
  vec3 eclipsedColor = vec3(0.02, 0.02, 0.05);

  vec3 color = mix(sunColor, eclipsedColor, eclipsed);
  gl_FragColor = vec4(color, 1.0 - rim);
}
`;

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
