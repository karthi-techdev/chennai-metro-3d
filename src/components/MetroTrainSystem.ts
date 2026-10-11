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
 * Generate glowing destination matrix texture (amber LED dots reading destination).
 */
function createDestinationBoardTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, 512, 128);

    // Amber LED matrix dots pattern
    ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
    for (let x = 6; x < 506; x += 8) {
      for (let y = 6; y < 122; y += 8) {
        ctx.fillRect(x, y, 4, 4);
      }
    }

    // Outer housing border
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, 496, 112);

    // Glowing Amber Destination Text
    ctx.font = 'bold 46px monospace, "Courier New", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fbbf24';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 12;
    ctx.fillText(text.toUpperCase(), 256, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  return tex;
}

/**
 * Generate circular CMRL crest medallion badge texture.
 */
function createCMRLBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);

    // Outer white bezel
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Inner Royal Blue circle
    ctx.beginPath();
    ctx.arc(128, 128, 108, 0, Math.PI * 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.fill();

    // Stylized transit track ring
    ctx.beginPath();
    ctx.arc(128, 128, 68, 0, Math.PI * 2);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Central CMRL insignia
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('CMRL', 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
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

      if (child.material) {
        // Clone so individual cars can have distinct lighting states
        if (Array.isArray(child.material)) {
          child.material = child.material.map((m) => m.clone());
        } else {
          child.material = child.material.clone();
        }

        const mats = Array.isArray(child.material) ? child.material : [child.material];

        mats.forEach((m) => {
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
      }
    }
  });
}

/**
 * High-fidelity 3D Metro Train Model System using the User's Provided Model:
 * `src/assets/3d/transperth_b-series__electric_passenger_train`
 * Colored in official Chennai Metro Phase 2 Royal Blue livery!
 */
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

        const trailerRoot = new THREE.Group();
        trailerRoot.add(carBGroup);
        trailerRoot.rotation.x = Math.PI / 2;

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

      // In cabClone, child 0 is carAGroup (local model coordinate space)
      const carAGroup = cabClone.children[0] as THREE.Group;

      if (isFrontCab && carAGroup) {
        // 1. Digital LED Destination Matrix [● LIGHT HOUSE] above windshield
        const destMat = new THREE.MeshBasicMaterial({
          map: (destText.includes('CENTRAL') ? this.destTextureCentral : this.destTextureLighthouse) || undefined,
          color: 0xffffff,
          side: THREE.DoubleSide,
        });
        const destPlane = new THREE.PlaneGeometry(1.5, 0.38);
        destPlane.rotateY(Math.PI / 2);
        destPlane.rotateZ(-0.38); // match windshield brow rake
        destPlane.translate(11.45, 0, 3.42);
        carAGroup.add(new THREE.Mesh(destPlane, destMat));

        // 2. Circular CMRL Crest Medallion on Front Nose
        if (this.cmrlLogoTexture) {
          const logoMat = new THREE.MeshBasicMaterial({
            map: this.cmrlLogoTexture,
            transparent: true,
            side: THREE.DoubleSide,
          });
          const logoPlane = new THREE.PlaneGeometry(0.44, 0.44);
          logoPlane.rotateY(Math.PI / 2);
          logoPlane.rotateZ(-0.25);
          logoPlane.translate(12.75, 0, 1.62);
          carAGroup.add(new THREE.Mesh(logoPlane, logoMat));
        }

        // 3. Forward Track Illuminating Light Beam
        const lightBeam = new THREE.PointLight(0xfff8e7, 2.2, 50);
        lightBeam.position.set(13.2, 0, 1.25);
        carAGroup.add(lightBeam);
      }

      group.add(cabClone);
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
    };

    if (this.isModelLoaded) {
      attachModel();
    } else {
      this.onModelLoaded(() => attachModel());
    }

    return group;
  }

  /**
   * Inter-Car Rubber Accordion Gangway Bellows
   */
  public static buildGangwayBellows(): THREE.Group {
    const group = new THREE.Group();
    const gangwayMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      metalness: 0.1,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });

    for (let i = -1.5; i <= 1.5; i++) {
      const pleat = new THREE.BoxGeometry(0.08, 2.3, 2.5);
      pleat.translate(i * 0.14, 0, 2.15);
      group.add(new THREE.Mesh(pleat, gangwayMat));
    }

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
  private static readonly BOGIE_WHEELBASE_HALF = 8.55; // Distance from car center to each bogie (wheelbase = 17.1m)
  private static readonly CAR_HALF_LENGTH = 12.07;      // Half-length of car body to inter-car coupler

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

    // Precise center-to-center offsets along track:
    // Car 0: 0.00m
    // Car 1: -24.75m
    // Car 2: -49.53m
    // Car 3: -74.27m
    this.carOffsets = [0, -24.75, -49.53, -74.27];

    // Initial position
    this.update(0);
  }

  /**
   * Updates train position along track path using real Two-Bogie Kinematics.
   * Both wheelsets of every car remain rigidly on the rails at all times.
   * Inter-car couplers and accordion gangways stay smoothly articulated with zero gaps.
   */
  public update(deltaSec: number) {
    const speedMs = this.speedKmh / 3.6;
    this.distanceMeters += speedMs * deltaSec;

    const b = TrainConsist.BOGIE_WHEELBASE_HALF;
    const carCouplers: { front: THREE.Vector3; rear: THREE.Vector3; heading: number }[] = [];

    // 1. Two-Bogie Kinematic Simulation for every car
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

      // Orientation vector along the chord between bogies
      const dx = ptFront.pos.x - ptRear.pos.x;
      const dy = ptFront.pos.y - ptRear.pos.y;
      const heading = Math.atan2(dy, dx);

      if (car.isFlipped) {
        car.group.rotation.set(0, 0, heading + Math.PI);
      } else {
        car.group.rotation.set(0, 0, heading);
      }

      // Compute exact world positions of front and rear couplers
      const fwd = new THREE.Vector3(Math.cos(heading), Math.sin(heading), 0);
      const frontCoupler = centerPos.clone().addScaledVector(fwd, TrainConsist.CAR_HALF_LENGTH);
      const rearCoupler = centerPos.clone().addScaledVector(fwd, -TrainConsist.CAR_HALF_LENGTH);

      carCouplers.push({ front: frontCoupler, rear: rearCoupler, heading });
    }

    // 2. Position and articulate inter-car rubber accordion gangways
    for (let g = 0; g < this.gangways.length; g++) {
      const leadingRear = carCouplers[g].rear;
      const trailingFront = carCouplers[g + 1].front;

      // Gangway position is exact midpoint between adjacent couplers
      const gangwayPos = new THREE.Vector3()
        .addVectors(leadingRear, trailingFront)
        .multiplyScalar(0.5);
      this.gangways[g].position.copy(gangwayPos);

      // Articulate gangway angle along the inter-car coupling vector
      const gHeading = Math.atan2(
        leadingRear.y - trailingFront.y,
        leadingRear.x - trailingFront.x
      );
      this.gangways[g].rotation.set(0, 0, gHeading);
    }
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

    // 1. Blue Line Northbound Train (Corridor 1 Up Track: offset -1.65m)
    const blueUp = new TrainConsist(
      'blue-up-1',
      'blue',
      bluePath,
      2400,
      -1.65,
      'WIMCO NAGAR'
    );
    this.trains.push(blueUp);
    this.group.add(blueUp.group);

    // 2. Blue Line North Extension Train (passing through New Washermanpet!)
    const blueUp2 = new TrainConsist(
      'blue-up-2',
      'blue',
      bluePath,
      8200,
      -1.65,
      'WIMCO NAGAR'
    );
    this.trains.push(blueUp2);
    this.group.add(blueUp2.group);

    // 3. Blue Line Southbound Train (Corridor 1 Down Track: offset +1.65m)
    const blueDown = new TrainConsist(
      'blue-down-1',
      'blue',
      bluePath,
      5600,
      1.65,
      'AIRPORT'
    );
    this.trains.push(blueDown);
    this.group.add(blueDown.group);

    // 4. Green Line Eastbound Train (Corridor 2 Up Track: offset -1.65m)
    const greenUp = new TrainConsist(
      'green-up-1',
      'green',
      greenPath,
      1400,
      -1.65,
      'CENTRAL METRO'
    );
    this.trains.push(greenUp);
    this.group.add(greenUp.group);

    // 5. Green Line Westbound Train (Corridor 2 Down Track: offset +1.65m)
    const greenDown = new TrainConsist(
      'green-down-1',
      'green',
      greenPath,
      2800,
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
