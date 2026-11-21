/**
 * The sky: a dome round the camera, deep blue overhead fading to the haze at
 * the horizon (the same colour as the fog, so the land melts into it), with
 * the sun's glow; by night, dark with stars.
 */
import { BackSide, Color, Mesh, RepeatWrapping, SRGBColorSpace, ShaderMaterial, SphereGeometry, Vector3, type Texture } from 'three';

export interface SkyColors {
  zenith: number;
  horizon: number;
  sun: number;
}

/** By day the horizon (and the fog the land fades into) takes the dusty tone of the photographed sky's foot. */
export const DAY_SKY: SkyColors = { zenith: 0x3f7fc8, horizon: 0xc2b6a4, sun: 0xfff3dc };
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
        uPhoto: { value: null as Texture | null },
        uHasPhoto: { value: 0 },
        uPhotoTurn: { value: 0 },
        uPhotoBottom: { value: -8 },
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
        uniform sampler2D uPhoto;
        uniform float uHasPhoto;
        uniform float uPhotoTurn;
        uniform float uPhotoBottom;
        varying vec3 vDir;
        float h2(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }
        float n2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), u.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int k = 0; k < 5; k++) {
            v += a * n2(p);
            p = p * 2.02 + 7.3;
            a *= 0.5;
          }
          return v;
        }
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
          // Fair-weather clouds: a thin scatter, on a plane above, thinning to the horizon.
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.6;
            float c = fbm(cp + vec2(3.1, 1.7));
            float cover = smoothstep(0.56, 0.78, c) * smoothstep(0.02, 0.22, d.y);
            float lit = 0.82 + 0.18 * smoothstep(0.5, 0.9, fbm(cp * 1.7 + 11.0));
            vec3 cloud = mix(vec3(1.0, 0.99, 0.97), uHorizon, 0.25) * lit;
            if (uNight > 0.5) cloud = uHorizon * 1.6;
            col = mix(col, cloud, cover * 0.85);
          }
          // Stars.
          if (uNight > 0.5 && d.y > 0.05) {
            vec3 g = d * 420.0;
            vec3 cell = floor(g);
            float star = step(0.996, hash(cell)) * smoothstep(0.35, 0.0, length(fract(g) - 0.5));
            col += vec3(star) * (0.5 + 0.5 * hash(cell + 3.0)) * smoothstep(0.05, 0.3, d.y);
          }
          // By day, a photographed desert sky with its mountains on the horizon (Poly Haven, CC0).
          if (uHasPhoto > 0.5 && uNight < 0.5) {
            float lon = atan(d.x, -d.z) / 6.2831853 + uPhotoTurn;
            float lat = degrees(asin(clamp(d.y, -1.0, 1.0)));
            // The photo is lifted by 2.5 degrees: the camera stands on a road above the plain, and
            // its mountains should stand on the far edge of our land, not behind the fog under it.
            // Low down the picture is squeezed (x1.7): its rocks, a few dozen metres from where it was
            // taken, sit lower and read as distant hills; from 40 degrees up it is as taken.
            float plat = lat < 40.0 ? (lat - 1.0) * 1.7 : mix(66.3, 90.0, (lat - 40.0) / 50.0);
            float v = (90.0 - plat) / (90.0 - uPhotoBottom);
            // (Textures are loaded bottom row first: v counts up from the foot of the picture.)
            vec3 photo = texture2D(uPhoto, vec2(fract(lon), 1.0 - clamp(v, 0.001, 0.999))).rgb * 1.15;
            // Distant mountains are paler (air between); below them, into the haze the land fades to.
            photo = mix(photo, uHorizon, 0.35 * (1.0 - smoothstep(2.0, 12.0, lat)));
            col = mix(photo, uHorizon, smoothstep(1.5, -0.5, lat));
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

  /**
   * Use a photographed sky by day: an equirectangular picture from the zenith
   * down to `bottom` degrees, turned so its sun (at `sunU` across it) stands
   * where the scene's sun light comes from.
   */
  setPhoto(tex: Texture, sunU: number, bottom: number): void {
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = RepeatWrapping;
    const u = this.mesh.material.uniforms;
    const sun = u.uSunDir!.value as Vector3;
    const sunLon = Math.atan2(sun.x, -sun.z) / (Math.PI * 2);
    u.uPhoto!.value = tex;
    u.uPhotoTurn!.value = sunU - sunLon;
    u.uPhotoBottom!.value = bottom;
    u.uHasPhoto!.value = 1;
  }

  setSunDirection(dir: Vector3): void {
    (this.mesh.material.uniforms.uSunDir!.value as Vector3).copy(dir).normalize();
  }

  /** Keep the dome centred on the camera. */
  follow(position: Vector3): void {
    this.mesh.position.copy(position);
  }
}
