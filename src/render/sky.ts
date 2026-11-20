/**
 * The sky: a dome round the camera, deep blue overhead fading to the haze at
 * the horizon (the same colour as the fog, so the land melts into it), with
 * the sun's glow; by night, dark with stars.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export interface SkyColors {
  zenith: number;
  horizon: number;
  sun: number;
}

export const DAY_SKY: SkyColors = { zenith: 0x3f7fc8, horizon: 0xdfe6ea, sun: 0xfff3dc };
export const NIGHT_SKY: SkyColors = { zenith: 0x03060f, horizon: 0x10162a, sun: 0x9fb4ff };

export class SkyDome {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;

  constructor(radius: number) {
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color(DAY_SKY.zenith) },
        uHorizon: { value: new Color(DAY_SKY.horizon) },
        uSunColor: { value: new Color(DAY_SKY.sun) },
        uSunDir: { value: new Vector3(0.4, 0.8, 0.3).normalize() },
        uNight: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          p.z = p.w * 0.9999; // always behind everything, never clipped
          gl_Position = p;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uNight;
        varying vec3 vDir;
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
          // Below the horizon: the haze (it is hidden by the land anyway).
          if (d.y < 0.0) col = uHorizon;
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          // The sun's disc and its glow (by night, the moon's).
          col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25 * (1.0 - uNight * 0.7));
          // Stars.
          if (uNight > 0.5 && d.y > 0.05) {
            vec3 g = d * 420.0;
            vec3 cell = floor(g);
            float star = step(0.996, hash(cell)) * smoothstep(0.35, 0.0, length(fract(g) - 0.5));
            col += vec3(star) * (0.5 + 0.5 * hash(cell + 3.0)) * smoothstep(0.05, 0.3, d.y);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  setColors(c: SkyColors, night: boolean): void {
    const u = this.mesh.material.uniforms;
    (u.uZenith!.value as Color).set(c.zenith);
    (u.uHorizon!.value as Color).set(c.horizon);
    (u.uSunColor!.value as Color).set(c.sun);
    u.uNight!.value = night ? 1 : 0;
  }

  setSunDirection(dir: Vector3): void {
    (this.mesh.material.uniforms.uSunDir!.value as Vector3).copy(dir).normalize();
  }

  /** Keep the dome centred on the camera. */
  follow(position: Vector3): void {
    this.mesh.position.copy(position);
  }
}
