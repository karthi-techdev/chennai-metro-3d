import * as THREE from 'three';
import * as maplibregl from 'maplibre-gl';
import { CHENNAI_METRO_LINES, CHENNAI_METRO_STATIONS, MetroStation } from '../data/chennaiMetroData';
import { MetroTrainFleet, TrackPath } from './MetroTrainSystem';
import { DayOfWeek, getSystemDayOfWeek } from '../data/metroScheduleEngine';

// Model origin: Alandur Interchange (where Green Line Level 2 soars over Blue Line Level 1)
export const MODEL_ORIGIN: [number, number] = [80.201453, 13.004256];

export const THREE_THEMES = {
  dark: {
    // Deck: Sleek crisp slate road/deck surface
    deck: 0x3a4d66,
    // Box girder soffit & chamfers: Architectural graphite concrete
    boxGirder: 0x223044,
    // Parapets: Outer barrier curb trim in light architectural stone
    parapet: 0x64748b,
    // Steel running rails: High-contrast polished steel
    rail: 0xffffff,
    railEmissive: 0x556677,
    // Corridor stripes: Electric transit glows
    greenStripe: 0x22c55e,
    blueStripe: 0x38bdf8,
    // Pier columns and hammerhead caps
    pier: 0x334155,
    cap: 0x475569,
    // Retaining trench walls & portal headwalls
    retainingWall: 0x475569,
    portal: 0x1e293b,
    portalVoid: 0x020617,
    // Elevated station architecture
    stationBody: 0x334155,
    stationRoof: 0x1e293b,
    stationGlass: 0x38bdf8,
    stationPlatform: 0x475569,
    stationTruss: 0x64748b,
    stationInteriorLight: 0xfef08a,
    // Lighting
    ambientColor: 0xffffff,
    ambientIntensity: 1.15,
    dirLight1Intensity: 1.6,
    dirLight2Intensity: 0.8,
  },
  light: {
    // Deck: Exact hsl(212, 25%, 75%) from Mapbox 3D Intersections post
    deck: 0x8fa3b8,
    // Box girder: Architectural concrete underbelly
    boxGirder: 0xb8c5d6,
    // Parapets: Warm stone / architectural concrete trim
    parapet: 0xd8d2c6,
    // Steel running rails: Polished steel
    rail: 0xffffff,
    railEmissive: 0x000000,
    // Corridor stripes
    greenStripe: 0x16a34a,
    blueStripe: 0x0284c7,
    // Piers
    pier: 0x94a3b8,
    cap: 0xa0aec0,
    // Retaining walls & portals
    retainingWall: 0xcbd5e1,
    portal: 0x475569,
    portalVoid: 0x0f172a,
    // Elevated station architecture
    stationBody: 0xe2e8f0,
    stationRoof: 0x94a3b8,
    stationGlass: 0x0284c7,
    stationPlatform: 0xf1f5f9,
    stationTruss: 0x64748b,
    stationInteriorLight: 0xffffff,
    // Lighting
    ambientColor: 0xffffff,
    ambientIntensity: 0.8,
    dirLight1Intensity: 1.2,
    dirLight2Intensity: 0.4,
  },
};

interface SamplePoint {
  x: number;  // Meters East of origin
  y: number;  // Meters South of origin
  z: number;  // Continuous height in meters above ground
  nx: number; // Unit normal X (horizontal)
  ny: number; // Unit normal Y (horizontal)
  tx: number; // Unit tangent X
  ty: number; // Unit tangent Y
}

/**
 * Chaikin's corner-cutting algorithm for silky smooth continuous curves.
 */
function chaikinSmooth(pts: [number, number][], iterations = 4): [number, number][] {
  let curr = pts;
  for (let it = 0; it < iterations; it++) {
    const next: [number, number][] = [curr[0]];
    for (let i = 0; i < curr.length - 1; i++) {
      const p0 = curr[i];
      const p1 = curr[i + 1];
      next.push([
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ]);
      next.push([
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
      ]);
    }
    next.push(curr[curr.length - 1]);
    curr = next;
  }
  return curr;
}

/**
 * Resamples polyline at uniform 3m metric intervals.
 */
function resamplePolyline(coords: [number, number][], stepMeters = 3): [number, number][] {
  if (coords.length < 2) return coords;
  const res: [number, number][] = [coords[0]];
  let leftover = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const latRad = (p1[1] * Math.PI) / 180;
    const dx = (p2[0] - p1[0]) * 111132 * Math.cos(latRad);
    const dy = (p2[1] - p1[1]) * 111132;
    const segLen = Math.hypot(dx, dy);

    if (segLen === 0) continue;

    let curDist = stepMeters - leftover;
    while (curDist <= segLen) {
      const t = curDist / segLen;
      const lng = p1[0] + t * (p2[0] - p1[0]);
      const lat = p1[1] + t * (p2[1] - p1[1]);
      res.push([lng, lat]);
      curDist += stepMeters;
    }
    leftover = segLen - (curDist - stepMeters);
  }

  res.push(coords[coords.length - 1]);
  return res;
}

/**
 * Builds a 100% continuous, seamless, manifold ribbon BufferGeometry
 * between two transverse offsets and vertical heights across all sample points.
 * Guarantees zero blocks, zero steps, zero cuts.
 */
function createRibbonGeometry(
  pts: SamplePoint[],
  wLeft: number,
  wRight: number,
  dzLeft: number,
  dzRight: number
): THREE.BufferGeometry | null {
  const n = pts.length;
  if (n < 2) return null;

  const vertexCount = (n - 1) * 6;
  const positions = new Float32Array(vertexCount * 3);
  let ptr = 0;

  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];

    const ax = p0.x + p0.nx * wLeft;
    const ay = p0.y + p0.ny * wLeft;
    const az = p0.z + dzLeft;

    const bx = p0.x + p0.nx * wRight;
    const by = p0.y + p0.ny * wRight;
    const bz = p0.z + dzRight;

    const cx = p1.x + p1.nx * wLeft;
    const cy = p1.y + p1.ny * wLeft;
    const cz = p1.z + dzLeft;

    const dx = p1.x + p1.nx * wRight;
    const dy = p1.y + p1.ny * wRight;
    const dz = p1.z + dzRight;

    // Tri 1: A, B, C
    positions[ptr++] = ax; positions[ptr++] = ay; positions[ptr++] = az;
    positions[ptr++] = bx; positions[ptr++] = by; positions[ptr++] = bz;
    positions[ptr++] = cx; positions[ptr++] = cy; positions[ptr++] = cz;

    // Tri 2: B, D, C
    positions[ptr++] = bx; positions[ptr++] = by; positions[ptr++] = bz;
    positions[ptr++] = dx; positions[ptr++] = dy; positions[ptr++] = dz;
    positions[ptr++] = cx; positions[ptr++] = cy; positions[ptr++] = cz;
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Fast geometry merger into a single non-indexed BufferGeometry for optimal GPU rendering.
 * Converts any indexed geometry (CylinderGeometry, BoxGeometry) to non-indexed triangle triples
 * to prevent cross-pillar vertex scrambling and diagonal artifact lines.
 */
function mergeGeometries(geoms: (THREE.BufferGeometry | null)[]): THREE.BufferGeometry {
  const valid = geoms
    .filter((g): g is THREE.BufferGeometry => g !== null)
    .map((g) => (g.index ? g.toNonIndexed() : g));

  let totalVerts = 0;
  valid.forEach((g) => { totalVerts += g.attributes.position.count; });

  const positions = new Float32Array(totalVerts * 3);
  let offset = 0;
  valid.forEach((g) => {
    positions.set(g.attributes.position.array, offset);
    offset += g.attributes.position.array.length;
  });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.computeVertexNormals();
  return merged;
}

export class ThreeMetroBridgeLayer implements maplibregl.CustomLayerInterface {
  id = 'three-metro-bridges';
  type = 'custom' as const;
  renderingMode = '3d' as const;

  private map: maplibregl.Map | null = null;
  private scene: THREE.Scene = new THREE.Scene();
  private camera: THREE.Camera = new THREE.Camera();
  private renderer: THREE.WebGLRenderer | null = null;

  private theme: 'light' | 'dark' = 'dark';
  private originMerc: maplibregl.MercatorCoordinate;
  private meterScale: number;

  // Active 3D Metro Train Fleet
  public trainFleet: MetroTrainFleet | null = null;
  private lastFrameTime: number = 0;
  private isPaused: boolean = false;

  // Lights
  private ambientLight = new THREE.AmbientLight();
  private dirLight1 = new THREE.DirectionalLight();
  private dirLight2 = new THREE.DirectionalLight();

  // Materials
  private deckMaterial = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
  private boxGirderMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  private parapetMaterial = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.15, side: THREE.DoubleSide });
  private railMaterial = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.8, side: THREE.DoubleSide });
  private greenStripeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
  private blueStripeMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide });
  private pierMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  private capMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  private retainingWallMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  private portalMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  private portalVoidMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  // Elevated Station Materials
  private stationBodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.2, side: THREE.DoubleSide });
  private stationRoofMaterial = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  private stationGlassMaterial = new THREE.MeshStandardMaterial({ roughness: 0.1, metalness: 0.7, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  private stationPlatformMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  private stationTrussMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  private stationInteriorGlowMaterial = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide });

  // Zero-heap preallocated matrix pool for 60+ FPS render performance
  private projMat = new THREE.Matrix4();
  private localMat = new THREE.Matrix4();
  private scaleVec = new THREE.Vector3();

  constructor(initialTheme: 'light' | 'dark' = 'dark') {
    this.theme = initialTheme;
    this.originMerc = maplibregl.MercatorCoordinate.fromLngLat(MODEL_ORIGIN, 0);
    this.meterScale = this.originMerc.meterInMercatorCoordinateUnits();
    this.camera.matrixAutoUpdate = false;
    this.initSceneLighting();
    this.buildAllBridgeMeshes();
    this.applyTheme(this.theme);
  }

  private addMesh(geom: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geom, material);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  private initSceneLighting() {
    this.dirLight1.position.set(150, -250, 400);
    this.dirLight2.position.set(-150, 250, 250);
    this.scene.add(this.ambientLight);
    this.scene.add(this.dirLight1);
    this.scene.add(this.dirLight2);
  }

  public setTheme(theme: 'light' | 'dark') {
    this.theme = theme;
    this.applyTheme(theme);
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  public getPaused(): boolean {
    return this.isPaused;
  }

  private applyTheme(theme: 'light' | 'dark') {
    const pal = THREE_THEMES[theme];

    this.ambientLight.color.setHex(pal.ambientColor);
    this.ambientLight.intensity = pal.ambientIntensity;
    this.dirLight1.intensity = pal.dirLight1Intensity;
    this.dirLight2.intensity = pal.dirLight2Intensity;

    this.deckMaterial.color.setHex(pal.deck);
    this.boxGirderMaterial.color.setHex(pal.boxGirder);
    this.parapetMaterial.color.setHex(pal.parapet);

    this.railMaterial.color.setHex(pal.rail);
    this.railMaterial.emissive.setHex(pal.railEmissive);

    this.greenStripeMaterial.color.setHex(pal.greenStripe);
    this.blueStripeMaterial.color.setHex(pal.blueStripe);

    this.pierMaterial.color.setHex(pal.pier);
    this.capMaterial.color.setHex(pal.cap);

    this.retainingWallMaterial.color.setHex(pal.retainingWall);
    this.portalMaterial.color.setHex(pal.portal);
    this.portalVoidMaterial.color.setHex(pal.portalVoid);

    // Station architectural materials
    this.stationBodyMaterial.color.setHex(pal.stationBody);
    this.stationRoofMaterial.color.setHex(pal.stationRoof);
    this.stationGlassMaterial.color.setHex(pal.stationGlass);
    this.stationPlatformMaterial.color.setHex(pal.stationPlatform);
    this.stationTrussMaterial.color.setHex(pal.stationTruss);
    this.stationInteriorGlowMaterial.color.setHex(pal.stationInteriorLight);
    this.stationInteriorGlowMaterial.emissive.setHex(theme === 'dark' ? pal.stationInteriorLight : 0x000000);
    this.stationInteriorGlowMaterial.emissiveIntensity = theme === 'dark' ? 0.7 : 0.0;

    this.trainFleet?.setTheme(theme);
  }

  private sampleLinePoints(
    coordinates: [number, number][],
    elevFn: (idx: number) => number
  ): SamplePoint[] {
    const smoothed = resamplePolyline(chaikinSmooth(coordinates, 4), 3);
    const n = smoothed.length;
    const pts: SamplePoint[] = [];

    for (let i = 0; i < n; i++) {
      const coord = smoothed[i];
      const pMerc = maplibregl.MercatorCoordinate.fromLngLat(coord, 0);
      const x = (pMerc.x - this.originMerc.x) / this.meterScale;
      const y = (pMerc.y - this.originMerc.y) / this.meterScale;
      const z = elevFn(i);

      // Smooth moving-window tangent
      const prev = smoothed[Math.max(0, i - 2)];
      const next = smoothed[Math.min(n - 1, i + 2)];
      const pPrevMerc = maplibregl.MercatorCoordinate.fromLngLat(prev, 0);
      const pNextMerc = maplibregl.MercatorCoordinate.fromLngLat(next, 0);

      const tx = (pNextMerc.x - pPrevMerc.x) / this.meterScale;
      const ty = (pNextMerc.y - pPrevMerc.y) / this.meterScale;
      const len = Math.hypot(tx, ty) || 1;

      // Normal perpendicular to tangent in horizontal plane
      const nx = -ty / len;
      const ny = tx / len;

      pts.push({
        x,
        y,
        z,
        nx,
        ny,
        tx: tx / len,
        ty: ty / len,
      });
    }

    return pts;
  }

  private buildAllBridgeMeshes() {
    const blueLineData = CHENNAI_METRO_LINES.find((l) => l.id === 'blue-line');
    const greenLineData = CHENNAI_METRO_LINES.find((l) => l.id === 'green-line');
    if (!blueLineData || !greenLineData) return;

    // -------------------------------------------------------------
    // GREEN LINE ELEVATION FUNCTION (Corridor 2)
    // -------------------------------------------------------------
    // GREEN LINE ELEVATION FUNCTION (Corridor 2)
    // 0 to 180: Level 1 Viaduct leaving St. Thomas Mount (12.5m)
    // 180 to 750: ALANDUR MULTI-TIER SOAR (climbing up to 19.5m, Level 2 soaring 7m OVER Blue Line!)
    // 750 to 3820: Level 1 Viaduct through Ekkattuthangal to Koyambedu (12.5m)
    // 3820 to 4015: Smooth Descent Ramp into Thirumangalam Portal (12.5m -> 0m)
    // 4015: Portal
    // -------------------------------------------------------------
    const greenElev = (i: number): number => {
      // 180 to 750: Alandur Upper Level Interchange (Level 2) - climbing up to 19.5m over Blue Line!
      if (i >= 180 && i <= 750) {
        const t = (i - 466) / 284;
        return 12.5 + 7.0 * Math.pow(Math.cos((t * Math.PI) / 2), 2);
      }
      if (i < 3820) return 12.5;
      if (i <= 4015) {
        // Ramp down into Thirumangalam portal entrance (12.5m -> 0.0m)
        const t = (i - 3820) / (4015 - 3820);
        const s = t * t * (3 - 2 * t);
        return 12.5 * (1 - s);
      }
      if (i <= 4165) {
        // Smooth descent from portal entrance (0.0m) into subterranean tunnel (-12.0m)
        const t = (i - 4015) / (4165 - 4015);
        const s = t * t * (3 - 2 * t);
        return -12.0 * s;
      }
      // Subterranean tunnel depth through Shenoy Nagar to Central
      return -12.0;
    };

    // -------------------------------------------------------------
    // BLUE LINE ELEVATION FUNCTION (Corridor 1)
    // 0 to 2720: Level 1 Viaduct (Airport through Alandur to Little Mount: 12.5m)
    // 2720 to 2880: Smooth Descent Ramp into Saidapet Portal (12.5m -> 0m)
    // 2880 to 8260: Subterranean Underground Tunnel (-12.0m)
    // 8260 to 8420: Smooth Ascent Ramp out of New Washermanpet (0m -> 12.5m)
    // 8420 to 10400: North Elevated Viaduct through Wimco Nagar (12.5m)
    // -------------------------------------------------------------
    const blueElev = (i: number): number => {
      if (i < 2720) return 12.5;
      if (i <= 2880) {
        // Saidapet descent ramp down to portal (12.5m -> 0.0m)
        const t = (i - 2720) / (2880 - 2720);
        const s = t * t * (3 - 2 * t);
        return 12.5 * (1 - s);
      }
      if (i <= 3030) {
        // Smooth descent from Saidapet portal (0.0m) into deep subterranean tunnel (-12.0m)
        const t = (i - 2880) / (3030 - 2880);
        const s = t * t * (3 - 2 * t);
        return -12.0 * s;
      }
      if (i < 8110) return -12.0;
      if (i <= 8260) {
        // Smooth ascent from deep tunnel (-12.0m) up to New Washermanpet portal (0.0m)
        const t = (i - 8110) / (8260 - 8110);
        const s = t * t * (3 - 2 * t);
        return -12.0 * (1 - s);
      }
      if (i <= 8420) {
        // Ascent ramp from portal (0.0m) onto northern elevated viaduct (12.5m)
        const t = (i - 8260) / (8420 - 8260);
        const s = t * t * (3 - 2 * t);
        return 12.5 * s;
      }
      return 12.5;
    };

    const greenPts = this.sampleLinePoints(greenLineData.coordinates, greenElev);
    const bluePts = this.sampleLinePoints(blueLineData.coordinates, blueElev);

    // Continuous Elevated Spans:
    // Green: 0 to 4015 (Entire viaduct and Thirumangalam transition ramp)
    const greenSpan = greenPts.slice(0, 4016);
    // Blue South: 0 to 2880 (Entire south viaduct, Alandur, Little Mount, Saidapet ramp)
    const blueSouthSpan = bluePts.slice(0, 2881);
    // Blue North: 8260 to 10400 (Tondiarpet ascent ramp, New Washermanpet, Tollgate, Thiruvottriyur, Wimco Nagar)
    const blueNorthSpan = bluePts.slice(8260, 10401);

    const allSpans = [greenSpan, blueSouthSpan, blueNorthSpan];


    // =========================================================================
    // 1. SLATE-BLUE RUNNING DECK (Continuous road/deck surface)
    // =========================================================================
    const deckGeoms: THREE.BufferGeometry[] = [];
    allSpans.forEach((span) => {
      const g = createRibbonGeometry(span, -4.0, 4.0, 1.2, 1.2);
      if (g) deckGeoms.push(g);
    });

    const mergedDeck = mergeGeometries(deckGeoms);
    this.addMesh(mergedDeck, this.deckMaterial);

    // =========================================================================
    // 2. STRUCTURAL BOX GIRDER SOFFIT & CHAMFER WEBS (Underbelly)
    // =========================================================================
    const girderGeoms: THREE.BufferGeometry[] = [];
    allSpans.forEach((span) => {
      const gBottom = createRibbonGeometry(span, -2.6, 2.6, 0.0, 0.0);
      const gLeft = createRibbonGeometry(span, -4.0, -2.6, 1.2, 0.0);
      const gRight = createRibbonGeometry(span, 2.6, 4.0, 0.0, 1.2);
      if (gBottom) girderGeoms.push(gBottom);
      if (gLeft) girderGeoms.push(gLeft);
      if (gRight) girderGeoms.push(gRight);
    });

    const mergedGirder = mergeGeometries(girderGeoms);
    this.addMesh(mergedGirder, this.boxGirderMaterial);

    // =========================================================================
    // 3. BEVELED OUTER PARAPET BARRIER CURBS (Left & Right trims)
    // =========================================================================
    const parapetGeoms: THREE.BufferGeometry[] = [];
    allSpans.forEach((span) => {
      const plOuter = createRibbonGeometry(span, -4.4, -4.4, 1.2, 2.4);
      const plTop = createRibbonGeometry(span, -4.4, -3.8, 2.4, 2.4);
      const plInner = createRibbonGeometry(span, -3.8, -3.8, 2.4, 1.2);

      const prInner = createRibbonGeometry(span, 3.8, 3.8, 1.2, 2.4);
      const prTop = createRibbonGeometry(span, 3.8, 4.4, 2.4, 2.4);
      const prOuter = createRibbonGeometry(span, 4.4, 4.4, 2.4, 1.2);

      if (plOuter) parapetGeoms.push(plOuter);
      if (plTop) parapetGeoms.push(plTop);
      if (plInner) parapetGeoms.push(plInner);
      if (prInner) parapetGeoms.push(prInner);
      if (prTop) parapetGeoms.push(prTop);
      if (prOuter) parapetGeoms.push(prOuter);
    });

    const mergedParapets = mergeGeometries(parapetGeoms);
    this.addMesh(mergedParapets, this.parapetMaterial);

    // =========================================================================
    // 4. TWIN STANDARD-GAUGE STEEL RUNNING RAILS (4 raised steel rail ribbons)
    // =========================================================================
    const railGeoms: THREE.BufferGeometry[] = [];
    allSpans.forEach((span) => {
      const r1 = createRibbonGeometry(span, -2.42, -2.28, 1.42, 1.42);
      const r2 = createRibbonGeometry(span, -1.02, -0.88, 1.42, 1.42);
      const r3 = createRibbonGeometry(span, 0.88, 1.02, 1.42, 1.42);
      const r4 = createRibbonGeometry(span, 2.28, 2.42, 1.42, 1.42);

      if (r1) railGeoms.push(r1);
      if (r2) railGeoms.push(r2);
      if (r3) railGeoms.push(r3);
      if (r4) railGeoms.push(r4);
    });

    const mergedRails = mergeGeometries(railGeoms);
    this.addMesh(mergedRails, this.railMaterial);

    // =========================================================================
    // 5. TRANSIT CORRIDOR IDENTIFIER STRIPES
    // =========================================================================
    const greenStripe = createRibbonGeometry(greenSpan, -0.22, 0.22, 1.23, 1.23);
    if (greenStripe) {
      this.addMesh(greenStripe, this.greenStripeMaterial);
    }

    const blueStripeS = createRibbonGeometry(blueSouthSpan, -0.22, 0.22, 1.23, 1.23);
    const blueStripeN = createRibbonGeometry(blueNorthSpan, -0.22, 0.22, 1.23, 1.23);
    const mergedBlueStripe = mergeGeometries([blueStripeS, blueStripeN]);
    this.addMesh(mergedBlueStripe, this.blueStripeMaterial);

    // =========================================================================
    // 5B. SUBTERRANEAN TUNNEL TRACK OVERLAYS (Translucent Rails & Glowing Lines)
    // =========================================================================
    const subGreenSpan = greenPts.slice(4015);
    const subBlueSpan = bluePts.slice(2880, 8261);

    const subRailGeoms: THREE.BufferGeometry[] = [];
    [subGreenSpan, subBlueSpan].forEach((span) => {
      if (span.length < 2) return;
      const r1 = createRibbonGeometry(span, -2.42, -2.28, 1.42, 1.42);
      const r2 = createRibbonGeometry(span, -1.02, -0.88, 1.42, 1.42);
      const r3 = createRibbonGeometry(span, 0.88, 1.02, 1.42, 1.42);
      const r4 = createRibbonGeometry(span, 2.28, 2.42, 1.42, 1.42);
      if (r1) subRailGeoms.push(r1);
      if (r2) subRailGeoms.push(r2);
      if (r3) subRailGeoms.push(r3);
      if (r4) subRailGeoms.push(r4);
    });
    const mergedSubRails = mergeGeometries(subRailGeoms);
    if (mergedSubRails) {
      const subRailMat = new THREE.MeshStandardMaterial({
        color: 0x64748b,
        metalness: 0.8,
        roughness: 0.3,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        depthWrite: false,
      });
      const subRailMesh = new THREE.Mesh(mergedSubRails, subRailMat);
      subRailMesh.renderOrder = 997;
      subRailMesh.matrixAutoUpdate = false;
      subRailMesh.updateMatrix();
      this.scene.add(subRailMesh);
    }

    const subGreenStripe = createRibbonGeometry(subGreenSpan, -0.22, 0.22, 1.25, 1.25);
    if (subGreenStripe) {
      const subGreenMat = new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        depthWrite: false,
      });
      const subGreenMesh = new THREE.Mesh(subGreenStripe, subGreenMat);
      subGreenMesh.renderOrder = 997;
      subGreenMesh.matrixAutoUpdate = false;
      subGreenMesh.updateMatrix();
      this.scene.add(subGreenMesh);
    }

    const subBlueStripe = createRibbonGeometry(subBlueSpan, -0.22, 0.22, 1.25, 1.25);
    if (subBlueStripe) {
      const subBlueMat = new THREE.MeshBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        depthWrite: false,
      });
      const subBlueMesh = new THREE.Mesh(subBlueStripe, subBlueMat);
      subBlueMesh.renderOrder = 997;
      subBlueMesh.matrixAutoUpdate = false;
      subBlueMesh.updateMatrix();
      this.scene.add(subBlueMesh);
    }

    // =========================================================================
    // 6. SUPPORT PIERS & CANTILEVER HAMMERHEAD CAPS (Every ~27m)
    // =========================================================================
    const pierGeoms: THREE.BufferGeometry[] = [];
    const capGeoms: THREE.BufferGeometry[] = [];

    // Identify all elevated stations and project them onto track spans
    const stationAnchors: {
      pt: SamplePoint;
      corridor: 'blue' | 'green';
      station: MetroStation;
      isAlandurLower?: boolean;
    }[] = [];

    const findClosestPoint = (coord: [number, number], span: SamplePoint[]): { pt: SamplePoint; dist: number } | null => {
      const pMerc = maplibregl.MercatorCoordinate.fromLngLat(coord, 0);
      const sx = (pMerc.x - this.originMerc.x) / this.meterScale;
      const sy = (pMerc.y - this.originMerc.y) / this.meterScale;

      let bestPt: SamplePoint | null = null;
      let minDist = Infinity;

      for (let i = 0; i < span.length; i++) {
        const p = span[i];
        const d = Math.hypot(p.x - sx, p.y - sy);
        if (d < minDist) {
          minDist = d;
          bestPt = p;
        }
      }

      return bestPt ? { pt: bestPt, dist: minDist } : null;
    };

    const elevatedStations = CHENNAI_METRO_STATIONS.filter((s) => s.type === 'Elevated');

    elevatedStations.forEach((st) => {
      if (st.id === 'alandur') {
        // Alandur is a signature two-level elevated interchange:
        // Level 2 (Upper Deck): Green Line soaring flyover (at elev 19.5m, Level 2)
        const matchGreen = findClosestPoint(st.coordinates, greenSpan);
        if (matchGreen && matchGreen.dist < 80) {
          stationAnchors.push({ pt: matchGreen.pt, corridor: 'green', station: st });
        }
        // Level 1 (Lower Deck): Blue Line 4-track station (at elev 12.5m, Level 1)
        const matchBlue = findClosestPoint(st.coordinates, blueSouthSpan);
        if (matchBlue && matchBlue.dist < 80) {
          stationAnchors.push({ pt: matchBlue.pt, corridor: 'blue', station: st, isAlandurLower: true });
        }
      } else if (st.line === 'green') {
        const match = findClosestPoint(st.coordinates, greenSpan);
        if (match && match.dist < 80) {
          stationAnchors.push({ pt: match.pt, corridor: 'green', station: st });
        }
      } else if (st.line === 'blue') {
        if (st.coordinates[1] < 13.05) {
          const match = findClosestPoint(st.coordinates, blueSouthSpan);
          if (match && match.dist < 80) {
            stationAnchors.push({ pt: match.pt, corridor: 'blue', station: st });
          }
        } else {
          const match = findClosestPoint(st.coordinates, blueNorthSpan);
          if (match && match.dist < 80) {
            stationAnchors.push({ pt: match.pt, corridor: 'blue', station: st });
          }
        }
      }
    });

    const generatePillarsForSpan = (span: SamplePoint[], step = 9, minElev = 3.5) => {
      for (let i = 0; i < span.length; i += step) {
        const p = span[i];
        if (p.z < minElev) continue;

        // Skip standard hammerhead piers directly under station buildings (where station portal bents support the deck)
        const isUnderStation = stationAnchors.some(
          (sa) => Math.hypot(sa.pt.x - p.x, sa.pt.y - p.y) < 38
        );
        if (isUnderStation) continue;

        const plinthH = 1.0;
        const plinthRadius = 1.45; // 2.9m wide crash-barrier foundation pedestal
        const colRadius = 1.05;    // 2.1m thick solid structural concrete column
        const capH = 1.4;          // 1.4m deep cantilever hammerhead pier head
        const colH = Math.max(0.4, p.z - capH - plinthH);

        // A. Heavy-Duty Ground Plinth Footing (Z: 0 -> 1.0m)
        const plinthGeom = new THREE.CylinderGeometry(plinthRadius, plinthRadius + 0.1, plinthH, 24);
        plinthGeom.rotateX(Math.PI / 2);
        plinthGeom.translate(p.x, p.y, plinthH / 2);
        pierGeoms.push(plinthGeom);

        // B. Main Cylindrical Pier Shaft (Z: 1.0m -> p.z - 1.4m)
        const colGeom = new THREE.CylinderGeometry(colRadius, colRadius, colH, 24);
        colGeom.rotateX(Math.PI / 2);
        colGeom.translate(p.x, p.y, plinthH + colH / 2);
        pierGeoms.push(colGeom);

        // C. Aerodynamic Cantilever Hammerhead Crosshead Beam (Under deck soffit)
        const angle = Math.atan2(p.ty, p.tx);

        // Upper bearing shelf beam (2.6m along track, 7.8m across track, 0.7m high)
        const shelfGeom = new THREE.BoxGeometry(2.6, 7.8, 0.7);
        shelfGeom.rotateZ(angle);
        shelfGeom.translate(p.x, p.y, p.z - 0.35);
        capGeoms.push(shelfGeom);

        // Tapered cantilever bracket (2.4m along track, 5.2m across track, 0.7m high)
        const bracketGeom = new THREE.BoxGeometry(2.4, 5.2, 0.7);
        bracketGeom.rotateZ(angle);
        bracketGeom.translate(p.x, p.y, p.z - 1.05);
        capGeoms.push(bracketGeom);
      }
    };

    // Green elevated piers (including Alandur soaring flyover up to 19.5m!)
    generatePillarsForSpan(greenPts.slice(0, 3820));
    // Blue South piers (Level 1 at 12.5m)
    generatePillarsForSpan(bluePts.slice(0, 2720));
    // Blue North piers (from ramp top at 8420 through Wimco Nagar)
    generatePillarsForSpan(bluePts.slice(8420, 10400));


    if (pierGeoms.length > 0) {
      const mergedPiers = mergeGeometries(pierGeoms);
      this.addMesh(mergedPiers, this.pierMaterial);
    }
    if (capGeoms.length > 0) {
      const mergedCaps = mergeGeometries(capGeoms);
      this.addMesh(mergedCaps, this.capMaterial);
    }

    // =========================================================================
    // 7. RETAINING TRENCH CUT WALLS & TUNNEL PORTAL ARCHES
    // =========================================================================
    const retainingGeoms: THREE.BufferGeometry[] = [];
    const portalGeoms: THREE.BufferGeometry[] = [];
    const portalVoidGeoms: THREE.BufferGeometry[] = [];

    // A. Thirumangalam Retaining Trench & Portal (Green Line)
    const greenTrench = greenPts.slice(3930, 4016);
    if (greenTrench.length > 1) {
      const wl = createRibbonGeometry(greenTrench, -5.2, -4.4, 0, 2.6);
      const wr = createRibbonGeometry(greenTrench, 4.4, 5.2, 0, 2.6);
      if (wl) retainingGeoms.push(wl);
      if (wr) retainingGeoms.push(wr);
    }
    const thiruPortalPt = greenPts[4015];
    if (thiruPortalPt) {
      const archGeom = new THREE.BoxGeometry(3.6, 11.2, 6.2);
      const angle = Math.atan2(thiruPortalPt.ty, thiruPortalPt.tx);
      archGeom.rotateZ(angle);
      archGeom.translate(thiruPortalPt.x, thiruPortalPt.y, 3.1);
      portalGeoms.push(archGeom);

      const voidGeom = new THREE.BoxGeometry(4.0, 8.4, 4.4);
      voidGeom.rotateZ(angle);
      voidGeom.translate(thiruPortalPt.x, thiruPortalPt.y, 2.2);
      portalVoidGeoms.push(voidGeom);
    }

    // B. Saidapet Retaining Trench & Portal (Blue Line South)
    const saidapetTrench = bluePts.slice(2800, 2881);
    if (saidapetTrench.length > 1) {
      const wl = createRibbonGeometry(saidapetTrench, -5.2, -4.4, 0, 2.6);
      const wr = createRibbonGeometry(saidapetTrench, 4.4, 5.2, 0, 2.6);
      if (wl) retainingGeoms.push(wl);
      if (wr) retainingGeoms.push(wr);
    }
    const saidapetPortalPt = bluePts[2880];
    if (saidapetPortalPt) {
      const archGeom = new THREE.BoxGeometry(3.6, 11.2, 6.2);
      const angle = Math.atan2(saidapetPortalPt.ty, saidapetPortalPt.tx);
      archGeom.rotateZ(angle);
      archGeom.translate(saidapetPortalPt.x, saidapetPortalPt.y, 3.1);
      portalGeoms.push(archGeom);

      const voidGeom = new THREE.BoxGeometry(4.0, 8.4, 4.4);
      voidGeom.rotateZ(angle);
      voidGeom.translate(saidapetPortalPt.x, saidapetPortalPt.y, 2.2);
      portalVoidGeoms.push(voidGeom);
    }

    // C. Tondiarpet North Portal & Retaining Trench (Blue Line North)
    const tondiarpetNorthTrench = bluePts.slice(8260, 8341);
    if (tondiarpetNorthTrench.length > 1) {
      const wl = createRibbonGeometry(tondiarpetNorthTrench, -5.2, -4.4, 0, 2.6);
      const wr = createRibbonGeometry(tondiarpetNorthTrench, 4.4, 5.2, 0, 2.6);
      if (wl) retainingGeoms.push(wl);
      if (wr) retainingGeoms.push(wr);
    }
    const tondiarpetNorthPortalPt = bluePts[8260];
    if (tondiarpetNorthPortalPt) {
      const archGeom = new THREE.BoxGeometry(3.6, 11.2, 6.2);
      const angle = Math.atan2(tondiarpetNorthPortalPt.ty, tondiarpetNorthPortalPt.tx);
      archGeom.rotateZ(angle);
      archGeom.translate(tondiarpetNorthPortalPt.x, tondiarpetNorthPortalPt.y, 3.1);
      portalGeoms.push(archGeom);

      const voidGeom = new THREE.BoxGeometry(4.0, 8.4, 4.4);
      voidGeom.rotateZ(angle);
      voidGeom.translate(tondiarpetNorthPortalPt.x, tondiarpetNorthPortalPt.y, 2.2);
      portalVoidGeoms.push(voidGeom);
    }

    if (retainingGeoms.length > 0) {
      const mergedTrench = mergeGeometries(retainingGeoms);
      this.addMesh(mergedTrench, this.retainingWallMaterial);
    }
    if (portalGeoms.length > 0) {
      const mergedPortals = mergeGeometries(portalGeoms);
      this.addMesh(mergedPortals, this.portalMaterial);
    }
    if (portalVoidGeoms.length > 0) {
      const mergedVoids = mergeGeometries(portalVoidGeoms);
      this.addMesh(mergedVoids, this.portalVoidMaterial);
    }

    // =========================================================================
    // 8. ELEVATED METRO STATION BUILDINGS WITH PASS-THROUGH TRAINWAY INTERIORS
    // =========================================================================
    const stationBodyGeoms: THREE.BufferGeometry[] = [];
    const stationRoofGeoms: THREE.BufferGeometry[] = [];
    const stationGlassGeoms: THREE.BufferGeometry[] = [];
    const stationPlatformGeoms: THREE.BufferGeometry[] = [];
    const stationTrussGeoms: THREE.BufferGeometry[] = [];
    const stationInteriorLightGeoms: THREE.BufferGeometry[] = [];
    const stationGreenAccentGeoms: THREE.BufferGeometry[] = [];
    const stationBlueAccentGeoms: THREE.BufferGeometry[] = [];

    stationAnchors.forEach(({ pt, corridor, isAlandurLower }) => {
      const angle = Math.atan2(pt.ty, pt.tx);
      const halfL = 40; // 80m standard station length
      const roofL = (halfL + 2) * 2; // 84m roof overhang
      const colH = Math.max(1.0, pt.z - 4.2);

      const placeGeom = (geom: THREE.BufferGeometry): THREE.BufferGeometry => {
        geom.rotateZ(angle);
        geom.translate(pt.x, pt.y, pt.z);
        return geom;
      };

      if (isAlandurLower) {
        // -------------------------------------------------------------
        // ALANDUR LEVEL 1 (LOWER LEVEL: BLUE LINE 12.5m DUAL TRACK)
        // -------------------------------------------------------------
        // Left Platform Slab (flanking track at -1.65m)
        const lpGeom = new THREE.BoxGeometry(halfL * 2 - 4, 4.4, 1.15);
        lpGeom.translate(0, -6.6, 1.725);
        stationPlatformGeoms.push(placeGeom(lpGeom));

        // Right Platform Slab (flanking track at +1.65m)
        const rpGeom = new THREE.BoxGeometry(halfL * 2 - 4, 4.4, 1.15);
        rpGeom.translate(0, 6.6, 1.725);
        stationPlatformGeoms.push(placeGeom(rpGeom));

        // Tactile Verge Coping along platform track edges
        const lCoping = new THREE.BoxGeometry(halfL * 2 - 4, 0.3, 0.08);
        lCoping.translate(0, -4.45, 2.34);
        stationPlatformGeoms.push(placeGeom(lCoping));

        const rCoping = new THREE.BoxGeometry(halfL * 2 - 4, 0.3, 0.08);
        rCoping.translate(0, 4.45, 2.34);
        stationPlatformGeoms.push(placeGeom(rCoping));

        // PSD balustrades along platform faces
        const lPsdGlass = new THREE.BoxGeometry(halfL * 2 - 6, 0.08, 1.55);
        lPsdGlass.translate(0, -4.4, 3.1);
        stationGlassGeoms.push(placeGeom(lPsdGlass));

        const rPsdGlass = new THREE.BoxGeometry(halfL * 2 - 6, 0.08, 1.55);
        rPsdGlass.translate(0, 4.4, 3.1);
        stationGlassGeoms.push(placeGeom(rPsdGlass));

        const lPsdRail = new THREE.BoxGeometry(halfL * 2 - 6, 0.14, 0.12);
        lPsdRail.translate(0, -4.4, 3.9);
        stationTrussGeoms.push(placeGeom(lPsdRail));

        const rPsdRail = new THREE.BoxGeometry(halfL * 2 - 6, 0.14, 0.12);
        rPsdRail.translate(0, 4.4, 3.9);
        stationTrussGeoms.push(placeGeom(rPsdRail));

        // Standard 18m Width Portals
        [-halfL, halfL].forEach((xPos) => {
          const lp = new THREE.BoxGeometry(2.4, 4.6, 5.6);
          lp.translate(xPos, -6.7, 3.9);
          stationTrussGeoms.push(placeGeom(lp));

          const rp = new THREE.BoxGeometry(2.4, 4.6, 5.6);
          rp.translate(xPos, 6.7, 3.9);
          stationTrussGeoms.push(placeGeom(rp));

          const lintel = new THREE.BoxGeometry(2.4, 18.0, 1.4);
          lintel.translate(xPos, 0, 6.1);
          stationTrussGeoms.push(placeGeom(lintel));

          const fascia = new THREE.BoxGeometry(0.5, 17.6, 0.9);
          fascia.translate(xPos + (xPos < 0 ? -1.3 : 1.3), 0, 6.3);
          stationBlueAccentGeoms.push(placeGeom(fascia));
        });

        // Intermediate transfer atrium columns rising to Level 2 (19.5m)
        [-24, 0, 24].forEach((xBent) => {
          const lCol = new THREE.CylinderGeometry(0.9, 0.9, 6.0, 16);
          lCol.rotateX(Math.PI / 2);
          lCol.translate(xBent, -8.0, 4.5);
          stationBodyGeoms.push(placeGeom(lCol));

          const rCol = new THREE.CylinderGeometry(0.9, 0.9, 6.0, 16);
          rCol.rotateX(Math.PI / 2);
          rCol.translate(xBent, 8.0, 4.5);
          stationBodyGeoms.push(placeGeom(rCol));
        });

        return; // Lower level complete; upper level has the main arched roof!
      }

      // -------------------------------------------------------------
      // STANDARD STATION & ALANDUR LEVEL 2 (UPPER DECK: 19.5m)
      // -------------------------------------------------------------
      // Left Platform Slab (width 4.4m, boarding height 2.3m, 1.1m above deck)
      const lpGeom = new THREE.BoxGeometry(halfL * 2 - 4, 4.4, 1.15);
      lpGeom.translate(0, -6.6, 1.725);
      stationPlatformGeoms.push(placeGeom(lpGeom));

      // Right Platform Slab
      const rpGeom = new THREE.BoxGeometry(halfL * 2 - 4, 4.4, 1.15);
      rpGeom.translate(0, 6.6, 1.725);
      stationPlatformGeoms.push(placeGeom(rpGeom));

      // Tactile Verge Coping along platform track edges
      const lCoping = new THREE.BoxGeometry(halfL * 2 - 4, 0.3, 0.08);
      lCoping.translate(0, -4.45, 2.34);
      stationPlatformGeoms.push(placeGeom(lCoping));

      const rCoping = new THREE.BoxGeometry(halfL * 2 - 4, 0.3, 0.08);
      rCoping.translate(0, 4.45, 2.34);
      stationPlatformGeoms.push(placeGeom(rCoping));

      // -------------------------------------------------------------
      // B. PLATFORM SCREEN DOORS (PSD) / SAFETY BALUSTRADES
      // -------------------------------------------------------------
      const lPsdGlass = new THREE.BoxGeometry(halfL * 2 - 6, 0.08, 1.55);
      lPsdGlass.translate(0, -4.4, 3.1);
      stationGlassGeoms.push(placeGeom(lPsdGlass));

      const rPsdGlass = new THREE.BoxGeometry(halfL * 2 - 6, 0.08, 1.55);
      rPsdGlass.translate(0, 4.4, 3.1);
      stationGlassGeoms.push(placeGeom(rPsdGlass));

      const lPsdRail = new THREE.BoxGeometry(halfL * 2 - 6, 0.14, 0.12);
      lPsdRail.translate(0, -4.4, 3.9);
      stationTrussGeoms.push(placeGeom(lPsdRail));

      const rPsdRail = new THREE.BoxGeometry(halfL * 2 - 6, 0.14, 0.12);
      rPsdRail.translate(0, 4.4, 3.9);
      stationTrussGeoms.push(placeGeom(rPsdRail));

      // -------------------------------------------------------------
      // C. EXTERIOR ENCLOSURE & SIDE WINDOW WALLS
      // -------------------------------------------------------------
      // Lower spandrel walls
      const lLowerWall = new THREE.BoxGeometry(halfL * 2 - 2, 0.3, 1.1);
      lLowerWall.translate(0, -8.95, 2.85);
      stationBodyGeoms.push(placeGeom(lLowerWall));

      const rLowerWall = new THREE.BoxGeometry(halfL * 2 - 2, 0.3, 1.1);
      rLowerWall.translate(0, 8.95, 2.85);
      stationBodyGeoms.push(placeGeom(rLowerWall));

      // Upper frieze walls
      const lUpperWall = new THREE.BoxGeometry(halfL * 2 - 2, 0.3, 1.4);
      lUpperWall.translate(0, -8.95, 6.0);
      stationBodyGeoms.push(placeGeom(lUpperWall));

      const rUpperWall = new THREE.BoxGeometry(halfL * 2 - 2, 0.3, 1.4);
      rUpperWall.translate(0, 8.95, 6.0);
      stationBodyGeoms.push(placeGeom(rUpperWall));

      // Glazed architectural viewing windows along platforms
      const lWindow = new THREE.BoxGeometry(halfL * 2 - 6, 0.08, 1.8);
      lWindow.translate(0, -8.95, 4.4);
      stationGlassGeoms.push(placeGeom(lWindow));

      const rWindow = new THREE.BoxGeometry(halfL * 2 - 6, 0.08, 1.8);
      rWindow.translate(0, 8.95, 4.4);
      stationGlassGeoms.push(placeGeom(rWindow));

      // -------------------------------------------------------------
      // D. ENTRANCE & EXIT PORTALS (Pass-Through Openings for Trains)
      // -------------------------------------------------------------
      const portalEnds = [-halfL, halfL];
      portalEnds.forEach((xPos) => {
        // Left Pylon Frame
        const lp = new THREE.BoxGeometry(2.4, 4.6, 5.6);
        lp.translate(xPos, -6.7, 3.9);
        stationTrussGeoms.push(placeGeom(lp));

        // Right Pylon Frame
        const rp = new THREE.BoxGeometry(2.4, 4.6, 5.6);
        rp.translate(xPos, 6.7, 3.9);
        stationTrussGeoms.push(placeGeom(rp));

        // Overhead Portal Lintel Beam (leaving 8.8m wide x 4.25m high hollow pass-through below!)
        const lintel = new THREE.BoxGeometry(2.4, 18.0, 1.4);
        lintel.translate(xPos, 0, 6.1);
        stationTrussGeoms.push(placeGeom(lintel));

        // Identity Brand Accent Fascia
        const fascia = new THREE.BoxGeometry(0.5, 17.6, 0.9);
        fascia.translate(xPos + (xPos < 0 ? -1.3 : 1.3), 0, 6.3);
        if (corridor === 'green') {
          stationGreenAccentGeoms.push(placeGeom(fascia));
        } else {
          stationBlueAccentGeoms.push(placeGeom(fascia));
        }
      });

      // -------------------------------------------------------------
      // E. VAULTED ARCHED CANOPY (Roof Shell & Central Skylight)
      // -------------------------------------------------------------
      // Left Curved Roof Wing (vaulting from y = -9.6m up to y = -2.2m)
      const lRoof1 = new THREE.BoxGeometry(roofL, 2.0, 0.2);
      lRoof1.translate(0, -8.6, 6.95);
      stationRoofGeoms.push(placeGeom(lRoof1));

      const lRoof2 = new THREE.BoxGeometry(roofL, 2.0, 0.2);
      lRoof2.translate(0, -6.7, 7.45);
      stationRoofGeoms.push(placeGeom(lRoof2));

      const lRoof3 = new THREE.BoxGeometry(roofL, 2.2, 0.2);
      lRoof3.translate(0, -4.7, 7.85);
      stationRoofGeoms.push(placeGeom(lRoof3));

      const lRoof4 = new THREE.BoxGeometry(roofL, 2.4, 0.2);
      lRoof4.translate(0, -2.5, 8.15);
      stationRoofGeoms.push(placeGeom(lRoof4));

      // Right Curved Roof Wing
      const rRoof1 = new THREE.BoxGeometry(roofL, 2.0, 0.2);
      rRoof1.translate(0, 8.6, 6.95);
      stationRoofGeoms.push(placeGeom(rRoof1));

      const rRoof2 = new THREE.BoxGeometry(roofL, 2.0, 0.2);
      rRoof2.translate(0, 6.7, 7.45);
      stationRoofGeoms.push(placeGeom(rRoof2));

      const rRoof3 = new THREE.BoxGeometry(roofL, 2.2, 0.2);
      rRoof3.translate(0, 4.7, 7.85);
      stationRoofGeoms.push(placeGeom(rRoof3));

      const rRoof4 = new THREE.BoxGeometry(roofL, 2.4, 0.2);
      rRoof4.translate(0, 2.5, 8.15);
      stationRoofGeoms.push(placeGeom(rRoof4));

      // Central Raised Clerestory Skylight
      const topSkylight = new THREE.BoxGeometry(roofL, 4.6, 0.08);
      topSkylight.translate(0, 0, 8.45);
      stationGlassGeoms.push(placeGeom(topSkylight));

      const lClereVent = new THREE.BoxGeometry(roofL, 0.08, 0.35);
      lClereVent.translate(0, -2.25, 8.3);
      stationGlassGeoms.push(placeGeom(lClereVent));

      const rClereVent = new THREE.BoxGeometry(roofL, 0.08, 0.35);
      rClereVent.translate(0, 2.25, 8.3);
      stationGlassGeoms.push(placeGeom(rClereVent));

      // Transverse Roof Structural Arch Ribs
      [-30, -18, -6, 6, 18, 30].forEach((xRib) => {
        const archRib = new THREE.BoxGeometry(0.8, 19.2, 0.45);
        archRib.translate(xRib, 0, 7.8);
        stationTrussGeoms.push(placeGeom(archRib));
      });

      // -------------------------------------------------------------
      // F. CONCOURSE LEVEL (Elevated Passenger Concourse Under Deck)
      // -------------------------------------------------------------
      const concourseFloor = new THREE.BoxGeometry(68, 16.4, 0.6);
      concourseFloor.translate(0, 0, -3.9);
      stationPlatformGeoms.push(placeGeom(concourseFloor));

      const lConcWall = new THREE.BoxGeometry(66, 0.3, 3.6);
      lConcWall.translate(0, -8.0, -1.9);
      stationBodyGeoms.push(placeGeom(lConcWall));

      const rConcWall = new THREE.BoxGeometry(66, 0.3, 3.6);
      rConcWall.translate(0, 8.0, -1.9);
      stationBodyGeoms.push(placeGeom(rConcWall));

      const fConcWall = new THREE.BoxGeometry(0.4, 16.0, 3.6);
      fConcWall.translate(-(halfL - 7), 0, -1.9);
      stationBodyGeoms.push(placeGeom(fConcWall));

      const bConcWall = new THREE.BoxGeometry(0.4, 16.0, 3.6);
      bConcWall.translate(+(halfL - 7), 0, -1.9);
      stationBodyGeoms.push(placeGeom(bConcWall));

      const lConcGlass = new THREE.BoxGeometry(62, 0.08, 1.8);
      lConcGlass.translate(0, -8.05, -2.0);
      stationGlassGeoms.push(placeGeom(lConcGlass));

      const rConcGlass = new THREE.BoxGeometry(62, 0.08, 1.8);
      rConcGlass.translate(0, 8.05, -2.0);
      stationGlassGeoms.push(placeGeom(rConcGlass));

      // -------------------------------------------------------------
      // G. STREET SUPPORT PORTAL BENTS & ENTRY ACCESS TOWERS
      // -------------------------------------------------------------
      [-24, 0, 24].forEach((xBent) => {
        // Left Portal Bent Column
        const lCol = new THREE.CylinderGeometry(1.05, 1.05, colH, 16);
        lCol.rotateX(Math.PI / 2);
        lCol.translate(xBent, -6.2, -4.2 - colH / 2);
        stationBodyGeoms.push(placeGeom(lCol));

        const lPlinth = new THREE.CylinderGeometry(1.4, 1.5, 1.0, 16);
        lPlinth.rotateX(Math.PI / 2);
        lPlinth.translate(xBent, -6.2, -pt.z + 0.5);
        stationBodyGeoms.push(placeGeom(lPlinth));

        // Right Portal Bent Column
        const rCol = new THREE.CylinderGeometry(1.05, 1.05, colH, 16);
        rCol.rotateX(Math.PI / 2);
        rCol.translate(xBent, 6.2, -4.2 - colH / 2);
        stationBodyGeoms.push(placeGeom(rCol));

        const rPlinth = new THREE.CylinderGeometry(1.4, 1.5, 1.0, 16);
        rPlinth.rotateX(Math.PI / 2);
        rPlinth.translate(xBent, 6.2, -pt.z + 0.5);
        stationBodyGeoms.push(placeGeom(rPlinth));

        // Transverse Straddle Crossbeam
        const straddleBeam = new THREE.BoxGeometry(2.4, 14.8, 0.8);
        straddleBeam.translate(xBent, 0, -4.4);
        stationBodyGeoms.push(placeGeom(straddleBeam));
      });

      // Street Entry Access Stair & Escalator Towers
      const lTower = new THREE.BoxGeometry(5.2, 3.0, colH);
      lTower.translate(-14, -9.6, -4.2 - colH / 2);
      stationBodyGeoms.push(placeGeom(lTower));

      const rTower = new THREE.BoxGeometry(5.2, 3.0, colH);
      rTower.translate(14, 9.6, -4.2 - colH / 2);
      stationBodyGeoms.push(placeGeom(rTower));

      const lStreetCanopy = new THREE.BoxGeometry(5.8, 3.6, 0.3);
      lStreetCanopy.translate(-14, -9.6, -pt.z + 2.8);
      stationBodyGeoms.push(placeGeom(lStreetCanopy));

      const rStreetCanopy = new THREE.BoxGeometry(5.8, 3.6, 0.3);
      rStreetCanopy.translate(14, 9.6, -pt.z + 2.8);
      stationBodyGeoms.push(placeGeom(rStreetCanopy));

      // -------------------------------------------------------------
      // H. INTERIOR ILLUMINATED PLATFORM CEILING LIGHTING STRIPS
      // -------------------------------------------------------------
      const lLightStrip = new THREE.BoxGeometry(72, 0.35, 0.12);
      lLightStrip.translate(0, -6.6, 6.2);
      stationInteriorLightGeoms.push(placeGeom(lLightStrip));

      const rLightStrip = new THREE.BoxGeometry(72, 0.35, 0.12);
      rLightStrip.translate(0, 6.6, 6.2);
      stationInteriorLightGeoms.push(placeGeom(rLightStrip));
    });

    if (stationBodyGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationBodyGeoms), this.stationBodyMaterial);
    }
    if (stationRoofGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationRoofGeoms), this.stationRoofMaterial);
    }
    if (stationGlassGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationGlassGeoms), this.stationGlassMaterial);
    }
    if (stationPlatformGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationPlatformGeoms), this.stationPlatformMaterial);
    }
    if (stationTrussGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationTrussGeoms), this.stationTrussMaterial);
    }
    if (stationInteriorLightGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationInteriorLightGeoms), this.stationInteriorGlowMaterial);
    }
    if (stationGreenAccentGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationGreenAccentGeoms), this.greenStripeMaterial);
    }
    if (stationBlueAccentGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationBlueAccentGeoms), this.blueStripeMaterial);
    }

    // -------------------------------------------------------------
    // 9. ACTIVE 3D CHENNAI METRO TRAIN FLEET
    // Real-time Kinematic Bogie Simulation on Tracks
    // -------------------------------------------------------------
    const greenTrackPath = new TrackPath(greenPts);
    const blueTrackPath = new TrackPath(bluePts);
    this.trainFleet = new MetroTrainFleet(greenTrackPath, blueTrackPath);
    this.scene.add(this.trainFleet.group);
  }

  // -------------------------------------------------------------
  // MapLibre CustomLayerInterface Implementation
  // -------------------------------------------------------------
  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, options: any) {
    if (!this.renderer || !this.map) return;

    // Retrieve the 4x4 modelViewProjectionMatrix from MapLibre
    const projMatArray = options?.modelViewProjectionMatrix || (Array.isArray(options) ? options : null);
    if (!projMatArray) return;

    // MapLibre's modelViewProjectionMatrix maps from pixel coordinates [x, y, z]
    // where x and y are in pixels (0 to worldSize = 512 * 2^zoom) and z is in meters!
    const worldSize = (this.map as any).transform?.worldSize ?? (512 * Math.pow(2, this.map.getZoom()));
    const px = this.originMerc.x * worldSize;
    const py = this.originMerc.y * worldSize;
    const pixelsPerMeter = this.meterScale * worldSize;

    // Use zero-heap preallocated matrix pool
    this.projMat.fromArray(projMatArray);
    this.scaleVec.set(pixelsPerMeter, pixelsPerMeter, 1);
    this.localMat.makeTranslation(px, py, 0).scale(this.scaleVec);
    this.camera.projectionMatrix.multiplyMatrices(this.projMat, this.localMat);

    // Real-time kinematic train physics update
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      const delta = this.isPaused ? 0 : (now - this.lastFrameTime) / 1000;
      if (delta > 0) {
        this.trainFleet?.update(delta);
      }
    }
    this.lastFrameTime = now;

    this.renderer.resetState();
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.renderer.render(this.scene, this.camera);
    if (!this.isPaused) {
      this.map.triggerRepaint();
    }
  }

  public setPaused(paused: boolean) {
    this.isPaused = paused;
    this.trainFleet?.setPaused(paused);
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  public setSelectedDay(day: DayOfWeek) {
    this.trainFleet?.setSelectedDay(day);
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  public getSelectedDay(): DayOfWeek {
    return this.trainFleet?.getSelectedDay() ?? getSystemDayOfWeek();
  }

  public getSimTime(): number {
    return this.trainFleet?.getSimTime() ?? 0;
  }

  onRemove() {
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.map = null;
  }
}
