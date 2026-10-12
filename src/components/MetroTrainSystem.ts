import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  tx: number;
  ty: number;
}

/**
 * Precomputed continuous spline track path parameterized by cumulative arc-length distance.
 */
export class TrackPath {
  public pts: TrackPoint[];
  public cumDist: number[] = [];
  public totalLength: number = 0;

  constructor(points: TrackPoint[]) {
    this.pts = points;
    this.computeDistances();
  }

  private computeDistances() {
    this.cumDist = new Array(this.pts.length);
    this.cumDist[0] = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const p0 = this.pts[i - 1];
      const p1 = this.pts[i];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const dz = p1.z - p0.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      this.cumDist[i] = this.cumDist[i - 1] + d;
    }
    this.totalLength = this.cumDist[this.cumDist.length - 1] || 1;
  }

  /**
   * Sample position and orientation along the track at distance `distMeters` with lateral `transverseOffset`.
   * Lateral offset: -1.65m for Up Track, +1.65m for Down Track.
   */
  public getPointAtDistance(
    distMeters: number,
    transverseOffset: number
  ): { pos: THREE.Vector3; tangent: THREE.Vector3; normal: THREE.Vector3; elev: number } {
    let d = distMeters;
    // Cyclic wrapping for continuous infinite running
    d = ((d % this.totalLength) + this.totalLength) % this.totalLength;

    // Binary search for interval
    let low = 0;
    let high = this.cumDist.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.cumDist[mid] < d) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const idx = Math.max(0, Math.min(this.pts.length - 2, low - 1));
    const d0 = this.cumDist[idx];
    const d1 = this.cumDist[idx + 1] || (d0 + 1);
    const t = Math.max(0, Math.min(1, (d - d0) / (d1 - d0 || 1)));

    const p0 = this.pts[idx];
    const p1 = this.pts[idx + 1];

    // Linear interpolation
    const x = p0.x + (p1.x - p0.x) * t;
    const y = p0.y + (p1.y - p0.y) * t;
    const z = p0.z + (p1.z - p0.z) * t;

    const tx = p0.tx + (p1.tx - p0.tx) * t;
    const ty = p0.ty + (p1.ty - p0.ty) * t;
    const tLen = Math.hypot(tx, ty) || 1;
    const unitTx = tx / tLen;
    const unitTy = ty / tLen;

    // Normal perpendicular to tangent in horizontal plane
    const nx = -unitTy;
    const ny = unitTx;

    // Rail deck top is z + 1.42m
    const worldX = x + transverseOffset * nx;
    const worldY = y + transverseOffset * ny;
    const worldZ = z + 1.42;

    return {
      pos: new THREE.Vector3(worldX, worldY, worldZ),
      tangent: new THREE.Vector3(unitTx, unitTy, 0),
      normal: new THREE.Vector3(nx, ny, 0),
      elev: z,
    };
  }
}

/**
 * Draw a clean rounded rectangle path.
 */
function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Generate glowing destination matrix texture (amber LED dots reading destination: ● LIGHT HOUSE).
 * Styled precisely after the official Chennai Metro Phase 2 Metropolis destination screen.
 */
function createDestinationBoardTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // 1. Dark charcoal/black cowl background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 1024, 256);

    // Pill bezel housing outer border
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 6;
    drawRoundedRectPath(ctx, 16, 16, 992, 224, 40);
    ctx.stroke();

    // Deep black interior matrix screen
    ctx.fillStyle = '#020617';
    drawRoundedRectPath(ctx, 24, 24, 976, 208, 32);
    ctx.fill();

    // Subtle amber LED matrix background dots grid
    ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
    for (let x = 32; x < 980; x += 14) {
      for (let y = 32; y < 220; y += 14) {
        ctx.fillRect(x, y, 6, 6);
      }
    }

    // Bright Amber circular indicator bullet on the left (matching reference: ● LIGHT HOUSE)
    ctx.beginPath();
    ctx.arc(105, 128, 22, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.shadowColor = '#d97706';
    ctx.shadowBlur = 18;
    ctx.fill();

    // Glowing Amber Destination Text (unmirrored transit LED display)
    ctx.font = 'bold 84px "Trebuchet MS", "Arial Black", -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 16;
    ctx.fillText(text.toUpperCase(), 155, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

/**
 * Generate circular CMRL crest medallion badge texture.
 * Vibrant Royal Blue circular center with white border and crisp CMRL emblem.
 */
function createCMRLBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 512, 512);

    // Outer white bezel ring
    ctx.beginPath();
    ctx.arc(256, 256, 240, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 12;
    ctx.fill();

    // Inner Royal Blue circle (#1d4ed8 / #2563eb)
    ctx.beginPath();
    ctx.arc(256, 256, 218, 0, Math.PI * 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.shadowBlur = 0;
    ctx.fill();

    // White stylized transit track ring
    ctx.beginPath();
    ctx.arc(256, 256, 140, 0, Math.PI * 2);
    ctx.lineWidth = 26;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Bold white CMRL insignia
    ctx.font = '900 84px "Arial Black", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('CMRL', 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  return tex;
}

/**
 * Shader hook that converts any remaining Transperth Green or Lime Yellow livery into official Chennai Metro Royal Blue!
 */
function applyChennaiMetroMaterials(root: THREE.Object3D, isRearDMC: boolean = false) {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;

      const name = (child.name || '').toLowerCase();
      let isInterior =
        name.includes('interior') ||
        name.includes('seat') ||
        name.includes('chair');

      if (child.material) {
        // Clone so individual cars can have distinct lighting states
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) => m.clone());
        } else {
          child.material = child.material.clone();
        }

        const mats = Array.isArray(child.material) ? child.material : [child.material];

        mats.forEach((m) => {
          const matName = (m.name || '').toLowerCase();
          if (matName.includes('interior')) {
            isInterior = true;
          }

          if (m instanceof THREE.MeshStandardMaterial) {
            const matName = m.name.toLowerCase();

            // 1. Exterior body materials: transform green/lime livery into Chennai Metro Electric Royal Blue
            if (
              matName.includes('exterior') ||
              matName.includes('a_series') ||
              matName.includes('trailer_exterior')
            ) {
              m.metalness = 0.65;
              m.roughness = 0.28;

              m.onBeforeCompile = (shader) => {
                shader.fragmentShader = shader.fragmentShader.replace(
                  '#include <map_fragment>',
                  `
                  #include <map_fragment>
                  // Convert sampled texel from RGB to HSV
                  vec3 rgb = diffuseColor.rgb;
                  vec4 K_hsv = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
                  vec4 p_hsv = mix(vec4(rgb.bg, K_hsv.wz), vec4(rgb.gb, K_hsv.xy), step(rgb.b, rgb.g));
                  vec4 q_hsv = mix(vec4(p_hsv.xyw, rgb.r), vec4(rgb.r, p_hsv.yzx), step(p_hsv.x, rgb.r));
                  float d_hsv = q_hsv.x - min(q_hsv.w, q_hsv.y);
                  float e_hsv = 1.0e-10;
                  vec3 hsv = vec3(abs(q_hsv.z + (q_hsv.w - q_hsv.y) / (6.0 * d_hsv + e_hsv)), d_hsv / (q_hsv.x + e_hsv), q_hsv.x);

                  // 1. Any Green / Lime livery (Hue 0.18 to 0.52, or high green content)
                  bool isGreenLivery = (hsv.x >= 0.18 && hsv.x <= 0.52 && hsv.y > 0.08) ||
                                       (rgb.g > rgb.b + 0.03 && rgb.g > rgb.r + 0.02);

                  // 2. Any Yellow / Gold / Amber / Orange trims (Hue 0.01 to 0.18 with saturation > 0.08)
                  bool isYellowTrims = (hsv.x >= 0.01 && hsv.x < 0.18 && hsv.y > 0.08) ||
                                       (rgb.r > 0.32 && rgb.g > 0.24 && rgb.b < 0.24);

                  if (isGreenLivery) {
                      // Remap to official Chennai Metro Phase 2 Royal Blue (Hue: 0.608, ~219 deg)
                      hsv.x = 0.608;
                      hsv.y = clamp(hsv.y * 1.4, 0.78, 0.98);
                      hsv.z = clamp(hsv.z * 1.15, 0.45, 0.95);

                      vec4 K_rgb = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                      vec3 p_rgb = abs(fract(hsv.xxx + K_rgb.xyz) * 6.0 - K_rgb.www);
                      diffuseColor.rgb = hsv.z * mix(K_rgb.xxx, clamp(p_rgb - K_rgb.xxx, 0.0, 1.0), hsv.y);
                  } else if (isYellowTrims) {
                      if (hsv.y > 0.35 && hsv.z > 0.5) {
                          // Accent trims -> Royal Blue
                          hsv.x = 0.608;
                          hsv.y = 0.85;
                          hsv.z = clamp(hsv.z * 0.9, 0.5, 0.85);
                          vec4 K_rgb = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                          vec3 p_rgb = abs(fract(hsv.xxx + K_rgb.xyz) * 6.0 - K_rgb.www);
                          diffuseColor.rgb = hsv.z * mix(K_rgb.xxx, clamp(p_rgb - K_rgb.xxx, 0.0, 1.0), hsv.y);
                      } else {
                          // Metallic Stainless Steel Silver
                          diffuseColor.rgb = vec3(0.82, 0.85, 0.89) * (0.3 + 0.7 * hsv.z);
                      }
                  }
                  `
                );
              };
            }

            // 2. Windows: obsidian tinted glass with zero amber glow
            if (matName.includes('window')) {
              m.color.setHex(0x060c18);
              m.roughness = 0.05;
              m.metalness = 0.95;
              m.emissive.setHex(0x000000);
              m.emissiveIntensity = 0.0;
            }

            // 3. Interior lights: soft cool-white modern LED passenger saloon lighting
            if (matName.includes('emission') && !matName.includes('light')) {
              m.color.setHex(0xe2e8f0);
              m.emissive.setHex(0xdbeafe);
              m.emissiveIntensity = 0.25;
            }

            // 4. Lights: white projector headlights on front DMC or ruby red tail lights on rear DMC
            if (matName.includes('train_light') || matName.includes('light')) {
              if (!isRearDMC) {
                m.emissive.setHex(0xffffff);
                m.emissiveIntensity = 2.5;
              } else {
                m.emissive.setHex(0xef4444);
                m.emissiveIntensity = 2.5;
              }
            }
          }
        });

        // Tag mesh so interior seats can be hidden when underground
        child.userData.isInterior = isInterior;
        child.userData.isExterior = !isInterior;
      }
    }
  });
}

/**
 * High-fidelity 3D Metro Train Model System using the User's Provided Model:
 * `src/assets/3d/transperth_b-series__electric_passenger_train`
 * Colored in official Chennai Metro Phase 2 Royal Blue livery!
 */
// Global Metro Train Model Scale factor (0.90 = reduced by 10% for realistic proportional fit)
export const TRAIN_MODEL_SCALE = 0.90;

export class MetroCarBuilder {
  private static cabTemplate: THREE.Group | null = null;
  private static trailerTemplate: THREE.Group | null = null;
  private static isModelLoaded = false;
  private static loadCallbacks: (() => void)[] = [];

  public static destTextureLighthouse: THREE.CanvasTexture | null = null;
  public static destTextureCentral: THREE.CanvasTexture | null = null;
  public static cmrlLogoTexture: THREE.CanvasTexture | null = null;

  public static initModelLoader() {
    if (this.isModelLoaded || this.loadCallbacks.length > 0) return;

    if (typeof document !== 'undefined') {
      this.destTextureLighthouse = createDestinationBoardTexture('LIGHT HOUSE');
      this.destTextureCentral = createDestinationBoardTexture('CENTRAL METRO');
      this.cmrlLogoTexture = createCMRLBadgeTexture();
    }

    const loader = new GLTFLoader();
    loader.load(
      '/models/chennai_metro/scene.gltf',
      (gltf) => {
        // Decompose matrices and ensure matrixAutoUpdate is true on all objects
        gltf.scene.traverse((obj) => {
          obj.updateMatrixWorld(true);
          obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
          obj.matrixAutoUpdate = true;
        });

        const sceneRoot = gltf.scene.getObjectByName('GLTF_SceneRootNode') || gltf.scene;

        const carAGroup = new THREE.Group();
        carAGroup.name = 'carA_group';
        const carBGroup = new THREE.Group();
        carBGroup.name = 'carB_group';

        // In sceneRoot, the 36 children partition cleanly at X = -10.0m:
        // Car A (Lead Driving Cab) has all nodes with X >= -10.0m (-7.54m to +9.49m)
        // Car B (Trailer/Pantograph Coach) has all nodes with X < -10.0m (-31.67m to -14.39m)
        const childrenToProcess = [...sceneRoot.children];
        childrenToProcess.forEach((child) => {
          child.matrixAutoUpdate = true;
          if (child.position.x < -10.0) {
            carBGroup.add(child);
          } else {
            carAGroup.add(child);
          }
        });

        // Center Car A between its two bogies (+9.49m and -7.54m, midpoint = +0.975m)
        carAGroup.position.x = -0.975;

        // Center Car B between its two bogies (-14.39m and -31.54m, midpoint = -22.965m)
        carBGroup.position.x = 22.965;

        // Wrap both in root containers rotated 90 deg around X:
        // Model Y (UP) becomes World Z (UP), Model Z (TRANSVERSE) becomes World -Y, Model X is FORWARD!
        const cabRoot = new THREE.Group();
        cabRoot.add(carAGroup);
        cabRoot.rotation.x = Math.PI / 2;
        cabRoot.scale.set(TRAIN_MODEL_SCALE, TRAIN_MODEL_SCALE, TRAIN_MODEL_SCALE);

        const trailerRoot = new THREE.Group();
        trailerRoot.add(carBGroup);
        trailerRoot.rotation.x = Math.PI / 2;
        trailerRoot.scale.set(TRAIN_MODEL_SCALE, TRAIN_MODEL_SCALE, TRAIN_MODEL_SCALE);

        this.cabTemplate = cabRoot;
        this.trailerTemplate = trailerRoot;
        this.isModelLoaded = true;

        this.loadCallbacks.forEach((cb) => cb());
        this.loadCallbacks = [];
      },
      undefined,
      (err) => {
        console.error('Failed to load Chennai Metro 3D model:', err);
      }
    );
  }

  public static onModelLoaded(cb: () => void) {
    if (this.isModelLoaded) {
      cb();
    } else {
      this.loadCallbacks.push(cb);
      this.initModelLoader();
    }
  }

  /**
   * Build Driving Cab Coach (DMC) from the 3D model with Chennai Metro livery and decals.
   */
  public static buildDrivingCabCoach(isFrontCab: boolean, destText: string = 'LIGHT HOUSE'): THREE.Group {
    this.initModelLoader();
    const group = new THREE.Group();

    const attachModel = () => {
      if (!this.cabTemplate) return;
      const cabClone = this.cabTemplate.clone(true);
      applyChennaiMetroMaterials(cabClone, !isFrontCab);
      group.add(cabClone);

      // Ensure textures are ready
      if (typeof document !== 'undefined') {
        if (!this.destTextureLighthouse) this.destTextureLighthouse = createDestinationBoardTexture('LIGHT HOUSE');
        if (!this.destTextureCentral) this.destTextureCentral = createDestinationBoardTexture('CENTRAL METRO');
        if (!this.cmrlLogoTexture) this.cmrlLogoTexture = createCMRLBadgeTexture();
      }

      // Add unmirrored destination board and CMRL crest in car's standard orientation (+X forward, +Y left, +Z up)
      // 1. Digital LED Destination Matrix [● LIGHT HOUSE] above windshield brow
      const destMat = new THREE.MeshBasicMaterial({
        map: (destText.includes('CENTRAL') ? this.destTextureCentral : this.destTextureLighthouse) || undefined,
        color: 0xffffff,
        side: THREE.DoubleSide,
      });
      // Geometry rotated so normal faces +X, UV horizontal runs -Y to +Y (left-to-right for observer), 100% UNMIRRORED!
      const destGeom = new THREE.PlaneGeometry(1.25, 0.28);
      destGeom.rotateY(Math.PI / 2);
      destGeom.rotateX(Math.PI / 2);
      // Invert horizontal UVs so text is 100% unmirrored and reads left-to-right from outside
      const destUvs = destGeom.attributes.uv.array;
      for (let i = 0; i < destUvs.length; i += 2) {
        destUvs[i] = 1 - destUvs[i];
      }
      destGeom.attributes.uv.needsUpdate = true;
      destGeom.rotateY(-0.32); // match windshield brow rake angle
      destGeom.translate(10.17, 0, 3.08); // center on windshield brow cowl
      const destMesh = new THREE.Mesh(destGeom, destMat);
      destMesh.name = isFrontCab ? 'dest_board_front' : 'dest_board_rear';
      destMesh.userData.isExterior = true;
      group.add(destMesh);

      // 2. Circular CMRL Crest Medallion on Front Nose Hood
      if (this.cmrlLogoTexture) {
        const logoMat = new THREE.MeshBasicMaterial({
          map: this.cmrlLogoTexture,
          transparent: true,
          side: THREE.DoubleSide,
        });
        const logoGeom = new THREE.PlaneGeometry(0.38, 0.38);
        logoGeom.rotateY(Math.PI / 2);
        logoGeom.rotateX(Math.PI / 2);
        // Invert horizontal UVs so medallion insignia is 100% unmirrored
        const logoUvs = logoGeom.attributes.uv.array;
        for (let i = 0; i < logoUvs.length; i += 2) {
          logoUvs[i] = 1 - logoUvs[i];
        }
        logoGeom.attributes.uv.needsUpdate = true;
        logoGeom.rotateY(-0.16); // match front nose slope
        logoGeom.translate(10.88, 0, 1.48); // centered on royal blue nose hood
        const logoMesh = new THREE.Mesh(logoGeom, logoMat);
        logoMesh.name = isFrontCab ? 'cmrl_logo_front' : 'cmrl_logo_rear';
        logoMesh.userData.isExterior = true;
        group.add(logoMesh);
      }

      // 3. Forward Track Illuminating Headlight Beam (on front cab only)
      if (isFrontCab) {
        const lightBeam = new THREE.PointLight(0xfff8e7, 2.2, 50);
        lightBeam.name = 'headlight_beam';
        lightBeam.position.set(11.2, 0, 1.25);
        group.add(lightBeam);
      }

      group.userData.undergroundRatio = undefined;
    };

    if (this.isModelLoaded) {
      attachModel();
    } else {
      this.onModelLoaded(() => attachModel());
    }

    return group;
  }

  /**
   * Build Middle Passenger Coach (MC with Pantograph or Trailer Coach) from the 3D model.
   */
  public static buildMiddleCoach(hasPantograph: boolean): THREE.Group {
    this.initModelLoader();
    const group = new THREE.Group();

    const attachModel = () => {
      if (!this.trailerTemplate) return;
      const trailerClone = this.trailerTemplate.clone(true);
      applyChennaiMetroMaterials(trailerClone, false);

      // Hide roof pantograph meshes for Trailer Coaches without pantograph
      if (!hasPantograph) {
        trailerClone.traverse((c) => {
          if (c.name && c.name.toLowerCase().includes('panto')) {
            c.visible = false;
          }
        });
      }

      group.add(trailerClone);
      group.userData.undergroundRatio = undefined;
    };

    if (this.isModelLoaded) {
      attachModel();
    } else {
      this.onModelLoaded(() => attachModel());
    }

    return group;
  }

  /**
   * Helper to create arched gangway geometry matching train roof curvature and bottom sill chamfers.
   * X = along track (thickness), Y = across track (width), Z = vertical (height).
   */
  private static createGangwayArchGeometry(
    w: number,
    zMin: number,
    zMax: number,
    thickness: number,
    rCornerTop: number = 0.22,
    rCornerBottom: number = 0.10
  ): THREE.BufferGeometry {
    const halfW = w / 2;
    const zCornerTop = zMax - rCornerTop;
    const zCornerBottom = zMin + rCornerBottom;

    const shape = new THREE.Shape();
    // Start at bottom center-left
    shape.moveTo(-halfW + rCornerBottom, zMin);
    // Bottom edge to bottom-right
    shape.lineTo(halfW - rCornerBottom, zMin);
    // Bottom-right rounded corner
    shape.quadraticCurveTo(halfW, zMin, halfW, zCornerBottom);
    // Right edge up to top-right corner
    shape.lineTo(halfW, zCornerTop);
    // Top-right rounded corner
    shape.quadraticCurveTo(halfW, zMax, halfW - rCornerTop, zMax);
    // Top edge to top-left corner
    shape.lineTo(-halfW + rCornerTop, zMax);
    // Top-left rounded corner
    shape.quadraticCurveTo(-halfW, zMax, -halfW, zCornerTop);
    // Left edge down to bottom-left corner
    shape.lineTo(-halfW, zCornerBottom);
    // Bottom-left rounded corner
    shape.quadraticCurveTo(-halfW, zMin, -halfW + rCornerBottom, zMin);
    shape.closePath();

    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 8,
    });

    geom.translate(0, 0, -thickness / 2);

    const m = new THREE.Matrix4().set(
      0, 0, 1, 0,
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 0, 1
    );
    geom.applyMatrix4(m);
    geom.computeVertexNormals();
    return geom;
  }

  /**
   * Inter-Car Rubber Accordion Gangway Bellows
   * Spans the inter-car gap seamlessly and articulates in 3D with true mechanical bellows kinematics.
   * Form-fitted to the car collar arch profile (width 1.58m, height from floor 0.848m up to roof 3.08m)
   * with zero excessive protrusion below.
   */
  public static buildGangwayBellows(): THREE.Group {
    const group = new THREE.Group();
    const pleats: THREE.Mesh[] = [];
    const segments: THREE.Mesh[] = [];

    const gangwayMat = new THREE.MeshStandardMaterial({
      color: 0x141416,
      metalness: 0.1,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const ribMat = new THREE.MeshStandardMaterial({
      color: 0x222226,
      metalness: 0.25,
      roughness: 0.82,
      side: THREE.DoubleSide,
    });
    const vestibuleEndMat = new THREE.MeshStandardMaterial({
      color: 0x0f0f12,
      metalness: 0.1,
      roughness: 0.98,
      side: THREE.DoubleSide,
    });
    const couplerMat = new THREE.MeshStandardMaterial({
      color: 0x3f3f46,
      metalness: 0.7,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const footplateMat = new THREE.MeshStandardMaterial({
      color: 0x1c1c20,
      metalness: 0.45,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });

    // 1. Vestibule Doorway Endcaps:
    // Placed at both ends of the gangway to seal the hollow doorway cutouts of both cars
    const endcapLeadGeom = this.createGangwayArchGeometry(1.46, 0.848, 3.05, 0.06, 0.20, 0.08);
    const endcapLead = new THREE.Mesh(endcapLeadGeom, vestibuleEndMat);
    endcapLead.name = 'gangway_endcap_lead';
    group.add(endcapLead);

    const endcapTrailGeom = this.createGangwayArchGeometry(1.46, 0.848, 3.05, 0.06, 0.20, 0.08);
    const endcapTrail = new THREE.Mesh(endcapTrailGeom, vestibuleEndMat);
    endcapTrail.name = 'gangway_endcap_trail';
    group.add(endcapTrail);

    // 2. Pleats: 9 alternating outer ribs and inner folds matching car collar arch perfectly from floor to roof
    const numPleats = 9;
    for (let i = 0; i < numPleats; i++) {
      const isOuter = i % 2 === 0;
      const w = isOuter ? 1.58 : 1.48;
      const zMin = isOuter ? 0.848 : 0.865;
      const zMax = isOuter ? 3.08 : 3.04;
      const thickness = isOuter ? 0.04 : 0.035;
      const rCornerTop = isOuter ? 0.22 : 0.20;
      const rCornerBottom = isOuter ? 0.10 : 0.08;

      const pleatGeom = this.createGangwayArchGeometry(w, zMin, zMax, thickness, rCornerTop, rCornerBottom);
      const pleat = new THREE.Mesh(pleatGeom, isOuter ? ribMat : gangwayMat);
      pleat.name = `gangway_pleat_${i}`;
      group.add(pleat);
      pleats.push(pleat);
    }

    // 3. Inner Connecting Bellows Web Segments between pleats
    for (let i = 0; i < numPleats - 1; i++) {
      const segGeom = this.createGangwayArchGeometry(1.42, 0.875, 3.00, 1.0, 0.18, 0.06);
      const seg = new THREE.Mesh(segGeom, gangwayMat);
      seg.name = `gangway_seg_${i}`;
      group.add(seg);
      segments.push(seg);
    }

    // 4. Gangway Walkway Threshold Floorplate (flush with car interior passenger floor at z = 0.838m)
    const footplateGeom = new THREE.BoxGeometry(1.0, 1.20, 0.02);
    footplateGeom.translate(0, 0, 0.838);
    const footplate = new THREE.Mesh(footplateGeom, footplateMat);
    footplate.name = 'gangway_footplate';
    group.add(footplate);

    // 5. Sleek undercarriage coupler link at draft gear level (z = 0.58m above rail)
    const couplerGeom = new THREE.BoxGeometry(1.0, 0.12, 0.08);
    couplerGeom.translate(0, 0, 0.58);
    const coupler = new THREE.Mesh(couplerGeom, couplerMat);
    coupler.name = 'gangway_coupler_bar';
    group.add(coupler);

    group.userData = { pleats, segments, endcapLead, endcapTrail, footplate, coupler, numPleats };
    return group;
  }
}

/**
 * A Complete 4-Car Metro Trainset Consist
 * Consisting of:
 * [DMC 1 Front] === [MC Pantograph] === [TC Trailer] === [DMC 2 Rear]
 * Total trainset length: ~96m
 */
export class TrainConsist {
  private static readonly BOGIE_WHEELBASE_HALF = 8.55 * TRAIN_MODEL_SCALE; // Distance from car center to each bogie (wheelbase scaled by 0.9)
  private static readonly CAR_HALF_LENGTH = 12.07 * TRAIN_MODEL_SCALE;      // Half-length of car body to inter-car coupler

  public group: THREE.Group = new THREE.Group();
  public path: TrackPath;
  public trackOffset: number; // -1.65 for Up Track, +1.65 for Down Track
  public speedKmh: number = 60; // Cruise speed in km/h
  public distanceMeters: number;
  public trainId: string;
  public line: 'blue' | 'green';

  private cars: { group: THREE.Group; isFlipped: boolean }[] = [];
  private gangways: THREE.Group[] = [];
  private carOffsets: number[] = [];

  constructor(
    id: string,
    line: 'blue' | 'green',
    path: TrackPath,
    startDistance: number,
    trackOffset: number,
    destinationText: string = 'LIGHT HOUSE'
  ) {
    this.trainId = id;
    this.line = line;
    this.path = path;
    this.distanceMeters = startDistance;
    this.trackOffset = trackOffset;

    // 1. Car 0: Lead Driving Motor Coach (DMC)
    const frontDMC = MetroCarBuilder.buildDrivingCabCoach(true, destinationText);
    this.cars.push({ group: frontDMC, isFlipped: false });
    this.group.add(frontDMC);

    // Gangway 1 (between Car 0 and Car 1)
    const g1 = MetroCarBuilder.buildGangwayBellows();
    this.gangways.push(g1);
    this.group.add(g1);

    // 2. Car 1: Motor Coach with Pantograph (MC)
    const middleMC = MetroCarBuilder.buildMiddleCoach(true);
    this.cars.push({ group: middleMC, isFlipped: false });
    this.group.add(middleMC);

    // Gangway 2 (between Car 1 and Car 2)
    const g2 = MetroCarBuilder.buildGangwayBellows();
    this.gangways.push(g2);
    this.group.add(g2);

    // 3. Car 2: Trailer Coach without Pantograph (TC)
    const middleTC = MetroCarBuilder.buildMiddleCoach(false);
    this.cars.push({ group: middleTC, isFlipped: false });
    this.group.add(middleTC);

    // Gangway 3 (between Car 2 and Car 3)
    const g3 = MetroCarBuilder.buildGangwayBellows();
    this.gangways.push(g3);
    this.group.add(g3);

    // 4. Car 3: Rear Driving Motor Coach (DMC, facing backwards with ruby red tail lights)
    const rearDMC = MetroCarBuilder.buildDrivingCabCoach(false, destinationText);
    this.cars.push({ group: rearDMC, isFlipped: true });
    this.group.add(rearDMC);

    // Precise center-to-center offsets along track (calibrated to actual car bounding boxes + 0.48m coupler gap):
    this.carOffsets = [
      0,
      -22.21,
      -44.45,
      -66.66,
    ];

    // Initial position
    this.update(0);
  }

  /**
   * Updates train position along track path using full 3D Kinematics (Pitch, Yaw, Roll).
   * Both wheelsets of every car remain rigidly on the rails with accurate slope pitch.
   * Inter-car couplers and accordion gangways dynamically articulate and flex in 3D with zero gaps.
   */
  public update(deltaSec: number) {
    const speedMs = this.speedKmh / 3.6;
    this.distanceMeters += speedMs * deltaSec;

    const b = TrainConsist.BOGIE_WHEELBASE_HALF;

    const carTransforms: {
      center: THREE.Vector3;
      fwd: THREE.Vector3;
      up: THREE.Vector3;
      qTrack: THREE.Quaternion;
      rearCoupler: THREE.Vector3;
      frontCoupler: THREE.Vector3;
    }[] = [];

    // Half-lengths from car center to coupler faces along longitudinal track axis:
    // Car 0 (DMC Lead): front nose = 11.36m, rear coupler = 10.85m
    // Car 1 (MC): front coupler = 10.88m, rear coupler = 10.88m
    // Car 2 (TC): front coupler = 10.88m, rear coupler = 10.88m
    // Car 3 (DMC Rear, flipped facing backwards): front coupler (towards Car 2) = 10.85m, rear nose = 11.36m
    const carEndLengths = [
      { front: 11.36, rear: 10.85 },
      { front: 10.88, rear: 10.88 },
      { front: 10.88, rear: 10.88 },
      { front: 10.85, rear: 11.36 },
    ];

    // 1. Full 3D Kinematic Simulation (Pitch, Yaw, Roll) for every car
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const carDist = this.distanceMeters + this.carOffsets[i];

      // Sample front and rear bogie positions on the track spline
      const ptFront = this.path.getPointAtDistance(carDist + b, this.trackOffset);
      const ptRear = this.path.getPointAtDistance(carDist - b, this.trackOffset);

      // Car center is the exact midpoint between the two bogies
      const centerPos = new THREE.Vector3()
        .addVectors(ptFront.pos, ptRear.pos)
        .multiplyScalar(0.5);
      car.group.position.copy(centerPos);
      this.updateCarElevationState(car.group, centerPos.z);

      // 3D chord vector from rear bogie to front bogie (full 3D direction including slope dz and turn dx, dy!)
      const chord = new THREE.Vector3().subVectors(ptFront.pos, ptRear.pos);
      const fwd = chord.clone().normalize();

      // Orthonormal frame (Forward, Left, Up) in full 3D:
      const worldUp = new THREE.Vector3(0, 0, 1);
      const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
      const left = right.clone().negate();

      const rotMatrix = new THREE.Matrix4();
      if (car.isFlipped) {
        // Rear cab DMC (Car 3) faces backward along track, roof pointing UP
        rotMatrix.makeBasis(
          fwd.clone().negate(),
          left.clone().negate(),
          up
        );
      } else {
        rotMatrix.makeBasis(fwd, left, up);
      }

      car.group.rotation.setFromRotationMatrix(rotMatrix);

      // Coupler face positions in world space along track forward direction:
      const frontCoupler = centerPos.clone().addScaledVector(fwd, carEndLengths[i].front);
      const rearCoupler = centerPos.clone().addScaledVector(fwd, -carEndLengths[i].rear);

      // Track-aligned 3D orientation quaternion
      const qTrack = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(fwd, left, up)
      );

      carTransforms.push({
        center: centerPos,
        fwd,
        up,
        qTrack,
        rearCoupler,
        frontCoupler,
      });
    }

    // 2. Position, Articulate, and Dynamically Flex Gangway Accordion Bellows with True Physics
    for (let g = 0; g < this.gangways.length; g++) {
      const gangway = this.gangways[g];
      const leading = carTransforms[g];
      const trailing = carTransforms[g + 1];

      const leadingRear = leading.rearCoupler;
      const trailingFront = trailing.frontCoupler;
      const span = leadingRear.distanceTo(trailingFront);

      const pMid = new THREE.Vector3().addVectors(leadingRear, trailingFront).multiplyScalar(0.5);
      this.updateGangwayElevationState(gangway, pMid.z);

      const { pleats, segments, endcapLead, endcapTrail, footplate, coupler, numPleats } = gangway.userData as {
        pleats: THREE.Mesh[];
        segments: THREE.Mesh[];
        endcapLead: THREE.Mesh;
        endcapTrail: THREE.Mesh;
        footplate: THREE.Mesh;
        coupler: THREE.Mesh;
        numPleats: number;
      };

      if (!pleats || pleats.length === 0) continue;

      // 1. Vestibule Doorway Endcaps:
      // Seals open doorway cutouts inside both cars so white car interior is never exposed
      if (endcapLead) {
        const pLead = new THREE.Vector3().lerpVectors(leadingRear, trailingFront, -0.22);
        endcapLead.position.copy(pLead);
        endcapLead.quaternion.copy(leading.qTrack);
      }
      if (endcapTrail) {
        const pTrail = new THREE.Vector3().lerpVectors(leadingRear, trailingFront, 1.22);
        endcapTrail.position.copy(pTrail);
        endcapTrail.quaternion.copy(trailing.qTrack);
      }

      // 2. True Accordion Bellows Kinematics:
      // Pleats start 8cm inside leading collar and terminate 8cm inside trailing collar,
      // completely bridging across the inter-car gap with zero visible longitudinal gaps.
      for (let i = 0; i < numPleats; i++) {
        const t = -0.16 + (i / (numPleats - 1)) * 1.32;
        const p = new THREE.Vector3().lerpVectors(leadingRear, trailingFront, t);
        const qClamp = THREE.MathUtils.clamp(t, 0, 1);
        const q = new THREE.Quaternion().copy(leading.qTrack).slerp(trailing.qTrack, qClamp);

        pleats[i].position.copy(p);
        pleats[i].quaternion.copy(q);
      }

      // Connecting inner accordion bellows segments between pleats
      for (let i = 0; i < numPleats - 1; i++) {
        const tMid = -0.16 + ((i + 0.5) / (numPleats - 1)) * 1.32;
        const p = new THREE.Vector3().lerpVectors(leadingRear, trailingFront, tMid);
        const qMidClamp = THREE.MathUtils.clamp(tMid, 0, 1);
        const q = new THREE.Quaternion().copy(leading.qTrack).slerp(trailing.qTrack, qMidClamp);
        const segLen = (span * 1.32) / (numPleats - 1);

        segments[i].position.copy(p);
        segments[i].quaternion.copy(q);
        segments[i].scale.set(segLen * 1.15, 1, 1);
      }

      // 3. Gangway Floor Footplate
      if (footplate) {
        const qChord = new THREE.Quaternion().copy(leading.qTrack).slerp(trailing.qTrack, 0.5);
        footplate.position.copy(pMid);
        footplate.quaternion.copy(qChord);
        footplate.scale.set(span * 1.10, 1, 1);
      }

      // 4. Mechanical coupler bar connecting draft gear at axle level
      if (coupler) {
        const qChord = new THREE.Quaternion().copy(leading.qTrack).slerp(trailing.qTrack, 0.5);
        coupler.position.copy(pMid);
        coupler.quaternion.copy(qChord);
        coupler.scale.set(span * 1.05, 1, 1);
      }
    }
  }

  /**
   * Updates opacity, depth-test, and interior visibility of a car based on its elevation.
   * - z >= 2.0m: Fully elevated (100% opaque, original design, interior seats visible)
   * - z <= -1.0m: Fully underground (40% ghost overlay, depthTest: false, interior seats completely HIDDEN)
   * - -1.0m < z < 2.0m: Smooth transition through portal
   */
  private updateCarElevationState(carGroup: THREE.Group, z: number) {
    if (carGroup.children.length === 0) return;

    const undergroundRatio = THREE.MathUtils.clamp((2.0 - z) / 3.0, 0, 1);
    const prevRatio = carGroup.userData.undergroundRatio;
    if (prevRatio !== undefined && Math.abs(prevRatio - undergroundRatio) < 0.005) {
      return;
    }
    carGroup.userData.undergroundRatio = undergroundRatio;

    const isFullyElevated = undergroundRatio <= 0.01;
    const isUnderground = undergroundRatio >= 0.99;
    const opacity = isFullyElevated ? 1.0 : (isUnderground ? 0.40 : 1.0 - undergroundRatio * 0.60);
    const transparent = !isFullyElevated;
    const depthTest = isFullyElevated;
    const renderOrder = isFullyElevated ? 0 : 999;

    carGroup.traverse((child) => {
      if (child.userData.isInterior) {
        // STRICT RULE: Hide interior seats whenever entering tunnel or underground!
        child.visible = isFullyElevated;
      } else if (child instanceof THREE.Mesh) {
        child.visible = true;
        child.castShadow = isFullyElevated;
        child.renderOrder = renderOrder;

        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m) {
            m.transparent = transparent;
            m.opacity = opacity;
            m.depthTest = true;
            m.depthWrite = true;

            const matName = (m.name || '').toLowerCase();
            if (matName.includes('window') && 'color' in m) {
              if (isFullyElevated) {
                (m as THREE.MeshStandardMaterial).color.setHex(0x060c18);
              } else {
                (m as THREE.MeshStandardMaterial).color.setHex(0x1e3a8a);
              }
            }
          }
        });
      } else if (child instanceof THREE.PointLight) {
        child.intensity = isFullyElevated ? 2.2 : 0.8;
      }
    });
  }

  private updateGangwayElevationState(gangway: THREE.Group, z: number) {
    if (gangway.children.length === 0) return;

    const undergroundRatio = THREE.MathUtils.clamp((2.0 - z) / 3.0, 0, 1);
    const prevRatio = gangway.userData.undergroundRatio;
    if (prevRatio !== undefined && Math.abs(prevRatio - undergroundRatio) < 0.005) {
      return;
    }
    gangway.userData.undergroundRatio = undergroundRatio;

    const isFullyElevated = undergroundRatio <= 0.01;
    const isUnderground = undergroundRatio >= 0.99;
    const opacity = isFullyElevated ? 1.0 : (isUnderground ? 0.40 : 1.0 - undergroundRatio * 0.60);
    const transparent = !isFullyElevated;
    const renderOrder = isFullyElevated ? 0 : 999;

    gangway.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m) {
            m.transparent = transparent;
            m.opacity = opacity;
            m.depthTest = true;
            m.depthWrite = true;
          }
        });
        child.renderOrder = renderOrder;
      }
    });
  }
}


/**
 * Fleet Manager for Chennai Metro 3D Trains
 * Manages active trainsets on both Blue and Green corridors.
 */
export class MetroTrainFleet {
  public group: THREE.Group = new THREE.Group();
  public trains: TrainConsist[] = [];

  constructor(greenPath: TrackPath, bluePath: TrackPath) {
    // Initialize 3D GLTF model loader
    MetroCarBuilder.initModelLoader();

    // 1. Blue Line Northbound Train (approaching Saidapet portal from south viaduct)
    const blueUp = new TrainConsist(
      'blue-up-1',
      'blue',
      bluePath,
      8200,
      -1.65,
      'WIMCO NAGAR'
    );
    this.trains.push(blueUp);
    this.group.add(blueUp.group);

    // 2. Blue Line Northbound Train (deep subterranean tunnel through Anna Salai / Central)
    const blueUp2 = new TrainConsist(
      'blue-up-2',
      'blue',
      bluePath,
      14000,
      -1.65,
      'WIMCO NAGAR'
    );
    this.trains.push(blueUp2);
    this.group.add(blueUp2.group);

    // 3. Blue Line Southbound Train (subterranean tunnel heading south toward Saidapet portal)
    const blueDown = new TrainConsist(
      'blue-down-1',
      'blue',
      bluePath,
      18000,
      1.65,
      'AIRPORT'
    );
    this.trains.push(blueDown);
    this.group.add(blueDown.group);

    // 4. Green Line Eastbound Train (approaching Thirumangalam underground portal)
    const greenUp = new TrainConsist(
      'green-up-1',
      'green',
      greenPath,
      11400,
      -1.65,
      'CENTRAL METRO'
    );
    this.trains.push(greenUp);
    this.group.add(greenUp.group);

    // 5. Green Line Westbound Train (deep underground tunnel through Shenoy Nagar)
    const greenDown = new TrainConsist(
      'green-down-1',
      'green',
      greenPath,
      16000,
      1.65,
      'ST. THOMAS MOUNT'
    );
    this.trains.push(greenDown);
    this.group.add(greenDown.group);
  }

  public update(deltaSec: number) {
    const clampedDelta = Math.min(deltaSec, 0.1);
    for (const train of this.trains) {
      train.update(clampedDelta);
    }
  }

  public setTheme(theme: 'light' | 'dark') {
    // Materials handle both Day and Night modes with metallic reflections and emissive glow
  }
}
