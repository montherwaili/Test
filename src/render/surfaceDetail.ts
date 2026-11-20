/**
 * Detail drawn by the graphics card instead of modelled: the grain of the
 * sand and the asphalt, and the windows on buildings. All of it is worked
 * out from where each pixel is in the world, so it costs no textures to
 * download and no extra triangles, and looks the same from any distance.
 *
 * Each function patches a stock Three.js material (lighting, shadows and fog
 * stay Three.js's own) by adding a few lines to its shaders.
 */
import { DataTexture, RepeatWrapping, SRGBColorSpace, TextureLoader, type Material, type Texture, type WebGLProgramParametersWithUniforms } from 'three';

/** Shared switch for night (lit windows): set `value` to 0 or 1. */
export const nightUniform = { value: 0 };

/** A 1x1 stand-in until the real picture arrives: mid-grey detail, a flat normal. */
function plain(r: number, g: number, b: number): Texture {
  const t = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}

/**
 * Photographed surface detail (Poly Haven, CC0; see public/textures/CREDITS.md):
 * the brightness of each picture and its relief (normal map). Colours stay the
 * game's own: the pictures only add the grain, cracks and texture.
 */
export const detailMaps = {
  sand: { value: plain(143, 143, 143) },
  sandN: { value: plain(128, 128, 255) },
  asphalt: { value: plain(90, 90, 90) },
  asphaltN: { value: plain(128, 128, 255) },
  plasterN: { value: plain(128, 128, 255) },
  paving: { value: plain(118, 118, 118) },
  pavingN: { value: plain(128, 128, 255) },
};

const FILES: Record<keyof typeof detailMaps, string> = {
  sand: 'sand-albedo.jpg',
  sandN: 'sand-normal.jpg',
  asphalt: 'asphalt-albedo.jpg',
  asphaltN: 'asphalt-normal.jpg',
  plasterN: 'plaster-normal.jpg',
  paving: 'paving-albedo.jpg',
  pavingN: 'paving-normal.jpg',
};

/** Fetch the pictures; each takes over from its stand-in as it arrives. */
export function loadDetailMaps(anisotropy: number): void {
  const loader = new TextureLoader();
  for (const key of Object.keys(FILES) as (keyof typeof detailMaps)[]) {
    loader.load(new URL(`textures/${FILES[key]}`, document.baseURI).href, (tex) => {
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.anisotropy = anisotropy;
      if (!key.endsWith('N')) tex.colorSpace = SRGBColorSpace;
      detailMaps[key].value = tex;
    });
  }
}

const MAPS_GLSL = /* glsl */ `
uniform sampler2D dSand;
uniform sampler2D dSandN;
uniform sampler2D dAsphalt;
uniform sampler2D dAsphaltN;
uniform sampler2D dPlasterN;
uniform sampler2D dPaving;
uniform sampler2D dPavingN;
/** A world-space normal tipped by a normal-map sample, along tangent t and bitangent b. */
vec3 dTip(vec3 n, vec3 t, vec3 b, vec3 tex, float strength) {
  vec3 m = tex * 2.0 - 1.0;
  m.xy *= strength;
  return normalize(t * m.x + b * m.y + n * m.z);
}
/** Two lookups at unrelated scales and angles, so no repeat shows. */
vec4 dTwice(sampler2D map, vec2 p, float scale) {
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p;
  return mix(texture2D(map, p / scale), texture2D(map, q / (scale * 2.37) + 0.31), 0.45);
}
`;

function useMaps(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.dSand = detailMaps.sand;
  shader.uniforms.dSandN = detailMaps.sandN;
  shader.uniforms.dAsphalt = detailMaps.asphalt;
  shader.uniforms.dAsphaltN = detailMaps.asphaltN;
  shader.uniforms.dPlasterN = detailMaps.plasterN;
  shader.uniforms.dPaving = detailMaps.paving;
  shader.uniforms.dPavingN = detailMaps.pavingN;
}

const NOISE = /* glsl */ `
float dHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float dNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), u.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float dFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int k = 0; k < 4; k++) {
    v += a * dNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

function patch(material: Material, key: string, edit: (shader: WebGLProgramParametersWithUniforms) => void): void {
  material.onBeforeCompile = edit;
  material.customProgramCacheKey = () => key;
}

/** Pass the world position (and, optionally, a per-vertex detail attribute) to the fragment shader. */
function worldPosition(shader: WebGLProgramParametersWithUniforms, withDetail: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec3 vDWorld;
varying vec3 vDNormal;
${withDetail ? 'attribute vec4 detail;\nvarying vec4 vDetail;' : ''}`,
    )
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
vDWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDNormal = normalize(mat3(modelMatrix) * objectNormal);
${withDetail ? 'vDetail = detail;' : ''}`,
    );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
varying vec3 vDWorld;
varying vec3 vDNormal;
${withDetail ? 'varying vec4 vDetail;' : ''}
${NOISE}
${MAPS_GLSL}`,
  );
  useMaps(shader);
}

/** Replace the shading normal (after Three.js has worked out its own) with a world-space one. */
function setNormal(shader: WebGLProgramParametersWithUniforms, glsl: string): void {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_maps>',
    `#include <normal_fragment_maps>
{
${glsl}
}`,
  );
}

/**
 * Desert sand: broad lighter and darker drifts, wind ripples, grain, and a
 * scatter of darker gravel and dry scrub.
 */
export function sandDetail(material: Material): void {
  patch(material, 'sand-detail', (shader) => {
    worldPosition(shader, false);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  vec2 p = vDWorld.xz;
  float broad = dFbm(p * 0.006);
  float mid = dFbm(p * 0.05 + 3.0);
  // Ripples running across the prevailing wind, broken up so they do not look combed.
  float ripple = sin(p.x * 0.9 + p.y * 0.35 + mid * 6.0) * 0.5 + 0.5;
  float grain = dHash(floor(p * 9.0));
  float shade = 0.84 + 0.22 * broad + 0.06 * mid + 0.035 * ripple + 0.05 * (grain - 0.5);
  diffuseColor.rgb *= shade;
  // Gravel and scrub: small dark spots, more of them in the darker drifts.
  float spot = dNoise(p * 1.7);
  float scrub = smoothstep(0.9 - 0.05 * (1.0 - broad), 0.95, spot);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.46, 0.34), scrub * 0.35);
  // The photographed sand: its light and shade, at its own scale (15 m).
  float photo = dTwice(dSand, p, 15.0).r / 0.562;
  diffuseColor.rgb *= mix(1.0, photo, 0.55);
}`,
    );
    setNormal(
      shader,
      `  vec3 nW = dTip(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, -1.0), dTwice(dSandN, vDWorld.xz, 15.0).rgb, 1.2);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`,
    );
  });
}

/** Asphalt: fine aggregate, darker repaired patches, and a lighter worn look in places. */
export function asphaltDetail(material: Material): void {
  patch(material, 'asphalt-detail', (shader) => {
    worldPosition(shader, false);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  vec2 p = vDWorld.xz;
  float grain = dHash(floor(p * 22.0)) - 0.5;
  float stones = step(0.93, dHash(floor(p * 11.0) + 7.0));
  float wear = dFbm(p * 0.035);
  // Repairs: rectangles of fresher, darker asphalt.
  vec2 cell = floor(p / vec2(9.0, 5.0));
  float repair = step(0.9, dHash(cell + 31.0));
  float shade = 0.9 + 0.22 * wear + 0.07 * grain + 0.12 * stones - 0.14 * repair;
  // The photographed asphalt: aggregate and cracks (3 m to a picture).
  float photo = dTwice(dAsphalt, p, 3.0).r / 0.351;
  diffuseColor.rgb *= shade * mix(1.0, photo, 0.7);
}`,
    );
    setNormal(
      shader,
      `  vec3 nW = dTip(vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, -1.0), dTwice(dAsphaltN, vDWorld.xz, 3.0).rgb, 1.0);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`,
    );
  });
}

/**
 * Buildings and everything else solid. Walls marked with a `detail`
 * attribute of (1, wall start, wall length, building height) get rows of
 * windows - framed, reflecting the sky, some lit at night - and a darker
 * plinth at the foot; other surfaces get a light weathering.
 */
export function facadeDetail(material: Material): void {
  patch(material, 'facade-detail', (shader) => {
    shader.uniforms.uNight = nightUniform;
    worldPosition(shader, true);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nfloat dLit = 0.0;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  // Weathering: walls a little darker low down, and not quite even.
  float even = dFbm(vDWorld.xz * 0.15 + vDWorld.y * 0.3);
  diffuseColor.rgb *= 0.93 + 0.1 * even;
  // Pavements: photographed paving slabs on top.
  if (vDetail.x > 1.5 && vDNormal.y > 0.5) diffuseColor.rgb *= mix(1.0, texture2D(dPaving, vDWorld.xz / 1.8).r / 0.463, 0.8);
  if (vDetail.x > 0.5 && abs(vDNormal.y) < 0.5) {
    float along = abs(vDNormal.x) > 0.5 ? vDWorld.z : vDWorld.x;
    float u = along - vDetail.y;
    float len = vDetail.z;
    float y = vDWorld.y;
    float count = max(1.0, floor(len / 3.4));
    float cell = len / count;
    float cu = mod(u, cell) - cell * 0.5;
    float idx = floor(u / cell);
    float floorH = 3.2;
    float fl = floor((y - 0.6) / floorH);
    float fy = mod(y - 0.6, floorH);
    float topFloor = floor((vDetail.w - 1.2) / floorH);
    bool inWindow = abs(cu) < 0.55 && fy > 0.75 && fy < 2.1 && fl >= 0.0 && fl <= topFloor && u > 0.4 && u < len - 0.4;
    bool inFrame = abs(cu) < 0.68 && fy > 0.62 && fy < 2.23 && fl >= 0.0 && fl <= topFloor && u > 0.3 && u < len - 0.3;
    // A darker plinth and a shadow line under the parapet.
    if (y < 0.45) diffuseColor.rgb *= 0.72;
    if (y > vDetail.w - 0.25 && y < vDetail.w) diffuseColor.rgb *= 0.8;
    if (inFrame && !inWindow) diffuseColor.rgb *= 0.78;
    if (inWindow) {
      // One random number per window: from whole numbers only, so it is the same over the whole pane.
      float wall = floor(vDetail.y + 0.5) * 0.37 + floor(vDetail.z + 0.5);
      float seed = dHash(vec2(idx, fl) * 1.31 + vec2(fract(wall * 0.0137) * 97.0, fract(wall * 0.0071) * 53.0));
      // Glass: dark, with the sky's colour across the top of each pane.
      vec3 glass = mix(vec3(0.10, 0.13, 0.17), vec3(0.42, 0.55, 0.68), smoothstep(1.1, 2.1, fy) * 0.6);
      glass *= 0.85 + 0.3 * seed;
      // Some windows have their blinds down.
      if (seed > 0.78) glass = vec3(0.62, 0.58, 0.5);
      diffuseColor.rgb = glass;
      dLit = step(0.55, fract(seed * 7.3)) * uNight;
    }
  }
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 n0 = normalize(vDNormal);
  if (vDetail.x > 0.5 && vDetail.x < 1.5 && abs(n0.y) < 0.5) {
    // Rendered plaster on the walls (2.5 m to a picture).
    bool alongZ = abs(n0.x) > 0.5;
    vec2 uv = vec2(alongZ ? vDWorld.z : vDWorld.x, vDWorld.y) / 2.5;
    vec3 nW = dTip(n0, alongZ ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), texture2D(dPlasterN, uv).rgb, 1.4);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  } else if (vDetail.x > 1.5 && n0.y > 0.5) {
    vec3 nW = dTip(n0, vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, -1.0), texture2D(dPavingN, vDWorld.xz / 1.8).rgb, 1.0);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  }
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * dLit * 0.85;`,
      );
  });
}
