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
  private stationSignMaterial = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
  private alandurFacadeMaterial = new THREE.MeshStandardMaterial({ color: 0xddd5c4, roughness: 0.78, metalness: 0.05, side: THREE.DoubleSide });
  // Opaque tinted curtain-wall glazing avoids transparent sorting artifacts in MapLibre's custom WebGL layer.
  private alandurGlassMaterial = new THREE.MeshStandardMaterial({ color: 0x245a70, roughness: 0.28, metalness: 0.12, side: THREE.DoubleSide });

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
    this.stationSignMaterial.color.setHex(0xf5c542);
    this.stationInteriorGlowMaterial.emissive.setHex(theme === 'dark' ? pal.stationInteriorLight : 0x000000);
    this.stationInteriorGlowMaterial.emissiveIntensity = theme === 'dark' ? 0.7 : 0.0;
    this.stationSignMaterial.color.setHex(0xf5c542);

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
    // 0 to 646: Level 1 Viaduct (Airport through Meenambakkam: 12.5m)
    // 646 to 757: South ramp down to ground portal (12.5m -> 0m)
    //            12.991857, 80.181656 -> 12.989969, 80.179268 climb (southbound)
    // 757 to 927: Underground between the two portals (-12.0m)
    //            12.994267, 80.185643 -> 12.991857, 80.181656
    // 927 to 1092: North ramp up from ground portal (0m -> 12.5m)
    //            12.996543, 80.189561 -> 12.994267, 80.185643 descent (southbound)
    // 1092 to 2720: Level 1 Viaduct (Nanganallur through Little Mount: 12.5m)
    // 2720 to 2880: Smooth Descent Ramp into Saidapet Portal (12.5m -> 0m)
    // 2880 to 8260: Subterranean Underground Tunnel (-12.0m)
    // 8260 to 8420: Smooth Ascent Ramp out of New Washermanpet (0m -> 12.5m)
    // 8420 to 10400: North Elevated Viaduct through Wimco Nagar (12.5m)
    // -------------------------------------------------------------
    const blueElev = (i: number): number => {
      // South of Meenambakkam dip: Airport elevated viaduct
      if (i < 646) return 12.5;
      if (i <= 757) {
        // South ramp: viaduct (12.5m) down to ground portal (0.0m)
        const t = (i - 646) / (757 - 646);
        const s = t * t * (3 - 2 * t);
        return 12.5 * (1 - s);
      }
      if (i <= 807) {
        // Smooth descent from south portal (0.0m) into subterranean tunnel (-12.0m)
        const t = (i - 757) / (807 - 757);
        const s = t * t * (3 - 2 * t);
        return -12.0 * s;
      }
      if (i < 877) return -12.0;
      if (i <= 927) {
        // Smooth ascent from tunnel (-12.0m) up to north portal (0.0m)
        const t = (i - 877) / (927 - 877);
        const s = t * t * (3 - 2 * t);
        return -12.0 * (1 - s);
      }
      if (i <= 1092) {
        // North ramp from portal (0.0m) onto elevated viaduct (12.5m)
        const t = (i - 927) / (1092 - 927);
        const s = t * t * (3 - 2 * t);
        return 12.5 * s;
      }
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
    // Blue Airport side: 0 to south portal (Meenambakkam viaduct + south ramp)
    const blueAirportSpan = bluePts.slice(0, 758);
    // Blue mid south: north portal through Alandur, Little Mount, Saidapet ramp
    const blueMidSpan = bluePts.slice(927, 2881);
    // Station search only (not a continuous ribbon — the dip between portals is underground)
    const blueSouthSpan = blueAirportSpan.concat(blueMidSpan);
    // Blue North: 8260 to 10400 (Tondiarpet ascent ramp, New Washermanpet, Tollgate, Thiruvottriyur, Wimco Nagar)
    const blueNorthSpan = bluePts.slice(8260, 10401);

    const allSpans = [greenSpan, blueAirportSpan, blueMidSpan, blueNorthSpan];


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

    const blueStripeAirport = createRibbonGeometry(blueAirportSpan, -0.22, 0.22, 1.23, 1.23);
    const blueStripeMid = createRibbonGeometry(blueMidSpan, -0.22, 0.22, 1.23, 1.23);
    const blueStripeN = createRibbonGeometry(blueNorthSpan, -0.22, 0.22, 1.23, 1.23);
    const mergedBlueStripe = mergeGeometries([blueStripeAirport, blueStripeMid, blueStripeN]);
    this.addMesh(mergedBlueStripe, this.blueStripeMaterial);

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

    const generatePillarsForSpan = (
      span: SamplePoint[],
      step = 9,
      minElev = 3.5,
      corridor: 'blue' | 'green' = 'blue'
    ) => {
      for (let i = 0; i < span.length; i += step) {
        const p = span[i];
        if (p.z < minElev) continue;

        // Alandur's Green Line flyover crosses above the Blue Line viaduct.
        // Ground-to-deck green piers placed on the crossing footprint visibly
        // punch through the lower Blue Line deck and collide with trains. Keep
        // this shared interchange envelope clear; the lower Blue deck has its
        // own independent piers and the green structure is carried by its other bays.
        if (corridor === 'green' && p.z > 15.0) {
          const overlapsBlueDeck = blueSouthSpan.some(
            (bluePt) => Math.hypot(bluePt.x - p.x, bluePt.y - p.y) < 10.5
          );
          if (overlapsBlueDeck) continue;
        }

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
    generatePillarsForSpan(greenPts.slice(0, 3820), 9, 3.5, 'green');
    // Blue South piers (Level 1 at 12.5m) — split around the Meenambakkam underground dip
    generatePillarsForSpan(bluePts.slice(0, 646));
    generatePillarsForSpan(bluePts.slice(1092, 2720));
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

    // B2. Meenambakkam south portal — climb back onto the Airport viaduct
    // Trench sits on the low end of the ramp, same length as Saidapet (81 samples)
    const meenambakkamSouthTrench = bluePts.slice(677, 758);
    if (meenambakkamSouthTrench.length > 1) {
      const wl = createRibbonGeometry(meenambakkamSouthTrench, -5.2, -4.4, 0, 2.6);
      const wr = createRibbonGeometry(meenambakkamSouthTrench, 4.4, 5.2, 0, 2.6);
      if (wl) retainingGeoms.push(wl);
      if (wr) retainingGeoms.push(wr);
    }
    const meenambakkamSouthPortalPt = bluePts[757];
    if (meenambakkamSouthPortalPt) {
      const archGeom = new THREE.BoxGeometry(3.6, 11.2, 6.2);
      const angle = Math.atan2(meenambakkamSouthPortalPt.ty, meenambakkamSouthPortalPt.tx);
      archGeom.rotateZ(angle);
      archGeom.translate(meenambakkamSouthPortalPt.x, meenambakkamSouthPortalPt.y, 3.1);
      portalGeoms.push(archGeom);

      const voidGeom = new THREE.BoxGeometry(4.0, 8.4, 4.4);
      voidGeom.rotateZ(angle);
      voidGeom.translate(meenambakkamSouthPortalPt.x, meenambakkamSouthPortalPt.y, 2.2);
      portalVoidGeoms.push(voidGeom);
    }

    // B3. Meenambakkam north portal — descent off the Nanganallur viaduct
    const meenambakkamNorthTrench = bluePts.slice(927, 1008);
    if (meenambakkamNorthTrench.length > 1) {
      const wl = createRibbonGeometry(meenambakkamNorthTrench, -5.2, -4.4, 0, 2.6);
      const wr = createRibbonGeometry(meenambakkamNorthTrench, 4.4, 5.2, 0, 2.6);
      if (wl) retainingGeoms.push(wl);
      if (wr) retainingGeoms.push(wr);
    }
    const meenambakkamNorthPortalPt = bluePts[927];
    if (meenambakkamNorthPortalPt) {
      const archGeom = new THREE.BoxGeometry(3.6, 11.2, 6.2);
      const angle = Math.atan2(meenambakkamNorthPortalPt.ty, meenambakkamNorthPortalPt.tx);
      archGeom.rotateZ(angle);
      archGeom.translate(meenambakkamNorthPortalPt.x, meenambakkamNorthPortalPt.y, 3.1);
      portalGeoms.push(archGeom);

      const voidGeom = new THREE.BoxGeometry(4.0, 8.4, 4.4);
      voidGeom.rotateZ(angle);
      voidGeom.translate(meenambakkamNorthPortalPt.x, meenambakkamNorthPortalPt.y, 2.2);
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
    // 8. ELEVATED METRO STATION BUILDINGS - REAL CMRL PHASE-1 ARCHITECTURE
    //
    // Real Chennai Metro elevated stations (Phase I Blue/Green corridors) have
    // an arched vaulted roof with a lengthwise central opening that runs the full
    // length of the platform envelope. Per CMRL reporting, this opening was to be
    // covered with galvalume + polycarbonate sheets (maintaining ventilation).
    // Phase-1 elevated platforms are OPEN at the track edge (no full-height platform
    // screen doors); the platform edge is shown with a yellow tactile warning strip
    // and edge profile, matching the observed open platform style.
    //
    // Real-world measurements modeled here:
    //   - Standard gauge 1.435m; UP/DOWN track centers at X = -1.65m / +1.65m
    //     (3.3m double-track separation); rail heads at deck + 1.42m.
    //   - Platform boarding level ~1.10m above railhead => platform slab top at
    //     2.52m. Platform width 6.0m each side; platform edge at 2.15m from the
    //     track centerline (car-body half-width ~1.47m + dynamic envelope margin).
    //   - Full train length for a 4-car consist: ~4 x 22.5m = 90.0m + coupler
    //     slack ~1.2m => ~91.2m. Station clear length is 110m -> a stopped
    //     consist sits ENTIRELY inside the building with >=9m margin at each end.
    //   - Roof: arched vault over each platform side plus a lengthwise central
    //     opening along the track centerline at ~Y=0; central opening covered with
    //     a translucent galvalume/polycarbonate strip (rendered as a separate
    //     material with light transmission so it reads correctly from above).
    //   - Roof soffit 4.7m above rail head (3.9m tall train + OLE clearance).
    //   - CMRL yellow name-board bands (dark text on yellow background): one band
    //     at each portal end (facing arriving train drivers) plus above-platform
    //     name boards (passenger facing from the platform).
    //   - Station columns/piers land beside the tracks (Y = ±4.75m) and drop from
    //     roof to ground, clear of the 3.3m-wide track box. No central row of
    //     columns under the lengthwise roof opening — the opening reads as a
    //     clerestory-style gap along the roof.
    //   - Street-level access cores are shown as minimal entrance pavilions at each
    //     end of the building (stair/escalator tower hint), under a small canopy.
    // =========================================================================

    const stationBodyGeoms: THREE.BufferGeometry[] = [];
    const stationRoofGeoms: THREE.BufferGeometry[] = [];
    const stationGlassGeoms: THREE.BufferGeometry[] = [];
    const stationPlatformGeoms: THREE.BufferGeometry[] = [];
    const stationTrussGeoms: THREE.BufferGeometry[] = [];
    const stationInteriorLightGeoms: THREE.BufferGeometry[] = [];
    const stationSignGeoms: THREE.BufferGeometry[] = [];
    const stationRoofOpeningGeoms: THREE.BufferGeometry[] = [];
    const stationGreenAccentGeoms: THREE.BufferGeometry[] = [];
    const stationBlueAccentGeoms: THREE.BufferGeometry[] = [];
    const alandurFacadeGeoms: THREE.BufferGeometry[] = [];
    const alandurGlassGeoms: THREE.BufferGeometry[] = [];

    // Real-world signature dimensions (meters)
    const STATION_CLEAR_LENGTH = 110;      // Inner clear length between portals (train fits inside)
    const STATION_ENVELOPE_LENGTH = 118;   // Total building length incl. portal frames
    const PLATFORM_WIDTH = 6.0;            // Each side platform slab width
    const PLATFORM_EDGE_Y = 3.9;            // Outer side-platform edge clears the full train-body envelope of the outer track
    const DECK_TOP_Z = 1.2;                // Deck slab surface height
    const RAIL_TOP_Z = 1.42;               // Railhead / running surface
    const PLATFORM_TOP_Z = RAIL_TOP_Z + 1.10; // Platform boarding level (2.52m)
    const ROOF_SOFFIT_Z = RAIL_TOP_Z + 4.7;   // Arched roof soffit clearance above rails
    const ROOF_RIDGE_Z = RAIL_TOP_Z + 5.6;    // Arc crest at apex of arched vault

    // Roof opening strip: center gap along length, covered with translucent panels
    const ROOF_OPENING_HALF_WIDTH = 1.9;  // Half of the lengthwise central gap (total 3.8m gap)
    const ROOF_OPENING_Y = 0.0;           // Centered on track centerline X-Z plane at Y=0

    stationAnchors.forEach(({ pt, corridor, station }) => {
      const angle = Math.atan2(pt.ty, pt.tx);
      const placeGeom = (geom: THREE.BufferGeometry): THREE.BufferGeometry => {
        geom.rotateZ(angle);
        geom.translate(pt.x, pt.y, pt.z);
        return geom;
      };

      const halfL = STATION_ENVELOPE_LENGTH / 2;

      // ALANDUR SIGNATURE INTERCHANGE: a long, street-facing glazed station
      // hall with cream concrete piers, deep blue curtain wall panels, a taller
      // glazed interchange core and an elevated pedestrian link. This is
      // deliberately station-specific; ordinary elevated stops keep the simpler
      // open-platform architecture below.
      if (station.id === 'alandur' && corridor === 'green') {
        // Apply the signature street-facing glass façade to Alandur's Green Line
        // level only. The lower Blue Line remains an open, roofless platform.
        // the platform edge so it cannot be hidden by the platform slab.
        const facadeBaseZ = DECK_TOP_Z + 0.65;
        // Keep the glass wall below the canopy eaves; tall panels above the roof
        // were the oversized fins visible in the previous screenshot.
        const facadeTopZ = ROOF_SOFFIT_Z - 0.25;
        const facadeHeight = facadeTopZ - facadeBaseZ;
        const facadeY = PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2 + 1.25;
        const bayWidth = 9.0;
        const bayCount = Math.floor((STATION_ENVELOPE_LENGTH - 8) / bayWidth);

        [-1, 1].forEach((side) => {
          // Blue-tinted glass curtain wall in individual bays, set back behind
          // concrete pilasters so the façade has depth rather than a flat decal.
          for (let bay = 0; bay < bayCount; bay++) {
            const x = -halfL + 4 + bay * bayWidth + bayWidth / 2;
            const glass = new THREE.BoxGeometry(bayWidth - 0.72, 0.34, facadeHeight - 0.48);
            glass.translate(x, side * facadeY, facadeBaseZ + facadeHeight / 2);
            alandurGlassGeoms.push(placeGeom(glass));

            // Thin horizontal mullions across each glazing bay.
            [facadeBaseZ + facadeHeight * 0.34, facadeBaseZ + facadeHeight * 0.68].forEach((z) => {
              const mullion = new THREE.BoxGeometry(bayWidth - 0.42, 0.2, 0.12);
              mullion.translate(x, side * (facadeY + 0.08), z);
              stationTrussGeoms.push(placeGeom(mullion));
            });
          }

          // Broad cream-coloured structural piers between glazing bays.
          for (let bay = 0; bay <= bayCount; bay++) {
            const x = -halfL + 4 + bay * bayWidth;
            const pier = new THREE.BoxGeometry(0.72, 0.72, facadeHeight + 0.35);
            pier.translate(x, side * (facadeY + 0.04), facadeBaseZ + facadeHeight / 2);
            alandurFacadeGeoms.push(placeGeom(pier));
          }

          // Solid cream end walls and a substantial roof fascia create the
          // characteristic enclosed station volume seen in the Alandur photos.
          const endWall = new THREE.BoxGeometry(1.0, 0.8, facadeHeight);
          endWall.translate(-halfL + 1.8, side * facadeY, facadeBaseZ + facadeHeight / 2);
          alandurFacadeGeoms.push(placeGeom(endWall));
          const endWall2 = new THREE.BoxGeometry(1.0, 0.8, facadeHeight);
          endWall2.translate(halfL - 1.8, side * facadeY, facadeBaseZ + facadeHeight / 2);
          alandurFacadeGeoms.push(placeGeom(endWall2));

          // Long continuous blue-green wave band across the glass frontage.
          // Layered thin strips evoke the CMRL façade graphics without text decals.
          // CMRL tricolour wave is kept as a restrained narrow band across the glazing.
          const waveBand = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH - 10, 0.18, 0.32);
          waveBand.translate(0, side * (facadeY + 0.22), facadeBaseZ + facadeHeight * 0.46);
          stationBlueAccentGeoms.push(placeGeom(waveBand));
          const lowerBand = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH - 10, 0.18, 0.14);
          lowerBand.translate(0, side * (facadeY + 0.23), facadeBaseZ + facadeHeight * 0.42);
          stationGreenAccentGeoms.push(placeGeom(lowerBand));
        });

        // Do not fabricate a floating pedestrian bridge here. The real Alandur
        // footbridge is a separate street-connected structure; an unanchored slab
        // across the station tracks looks incorrect in this map-scale model.
      }

      // ----------------------------------------------------------------
      // A. PLATFORM SLABS (Flanking both tracks at boarding height)
      // ----------------------------------------------------------------
      [-1, 1].forEach((side) => {
        // Platform slab: full clear length, 6.0m wide, 1.05m thick
        const slab = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, PLATFORM_WIDTH, 1.05);
        slab.translate(0, side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2), PLATFORM_TOP_Z - 1.05 / 2);
        stationPlatformGeoms.push(placeGeom(slab));

        // Yellow tactile warning strip along platform edge (wide, low)
        const tactile = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.6, 0.05);
        tactile.translate(0, side * (PLATFORM_EDGE_Y + 0.3), PLATFORM_TOP_Z + 0.02);
        stationSignGeoms.push(placeGeom(tactile));

        // Platform edge nosing (white/yellow edge profile)
        const edgeNosing = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.18, 0.08);
        edgeNosing.translate(0, side * (PLATFORM_EDGE_Y - 0.05), PLATFORM_TOP_Z + 0.04);
        stationSignGeoms.push(placeGeom(edgeNosing));
      });

      // ----------------------------------------------------------------
      // B. OPEN TRACK EDGE: no full-height PSDs on phase-1 elevated.
      //    The track edge is left open (tactile + edge nosing only), which
      //    matches observed CMRL phase-1 elevated platform style.
      // ----------------------------------------------------------------

      // ----------------------------------------------------------------
      // C. CMRL YELLOW STATION NAME BOARDS - passenger-facing
      //    Mounted above the platform level, facing passengers, at two
      //    longitudinal spots per platform (so the name reads from both
      //    the platform and looks correct from the building frontage).
      // ----------------------------------------------------------------
      [-1, 1].forEach((side) => {
        // Sign board: yellow panel with dark text-like contrast panel
        for (let xSign of [-22, 22] as const) {
          const board = new THREE.BoxGeometry(9.0, 0.18, 0.5);
          board.translate(xSign, side * (PLATFORM_EDGE_Y + 0.9), PLATFORM_TOP_Z + 1.55);
          stationSignGeoms.push(placeGeom(board));

          // Dark contrasting label panel (represents the dark text/crest on CMRL yellow sign)
          const label = new THREE.BoxGeometry(8.4, 0.10, 0.42);
          label.translate(xSign, side * (PLATFORM_EDGE_Y + 0.9), PLATFORM_TOP_Z + 1.55);
          stationBodyGeoms.push(placeGeom(label));
        }
      });

      // ----------------------------------------------------------------
      // D. END PORTAL FRAMES (Train pass-through openings, 4.0m+ tall clear)
      //    Portal openings run between the two tracks (clear of envelope).
      // ----------------------------------------------------------------
      // Open station portals: keep only slim side jambs and a modest overhead
      // beam. A full-width colored fascia here created the giant cyan bar seen
      // in the camera view and made the station look like a tunnel gate.
      [-1, 1].forEach((xEnd) => {
        const xPos = xEnd * halfL;
        [-1, 1].forEach((side) => {
          const jamb = new THREE.BoxGeometry(0.55, 0.55, ROOF_SOFFIT_Z - DECK_TOP_Z);
          jamb.translate(
            xPos,
            side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2 + 0.35),
            (ROOF_SOFFIT_Z + DECK_TOP_Z) / 2
          );
          stationTrussGeoms.push(placeGeom(jamb));
        });

        const lintel = new THREE.BoxGeometry(0.45, 12.8, 0.42);
        lintel.translate(xPos, 0, ROOF_SOFFIT_Z - 0.2);
        stationTrussGeoms.push(placeGeom(lintel));

        // Small corridor-colour marker at the outer end, not a full-width fascia.
        const fascia = new THREE.BoxGeometry(0.16, 2.4, 0.22);
        fascia.translate(xEnd * (halfL + 0.05), 0, ROOF_SOFFIT_Z - 0.55);
        if (corridor === 'green') stationGreenAccentGeoms.push(placeGeom(fascia));
        else stationBlueAccentGeoms.push(placeGeom(fascia));
      });

      // ----------------------------------------------------------------
      // E. ARCHED VAULTED ROOF with lengthwise central opening
      //    Two side roof shells over the platforms + a central opening
      //    along the roof centerline (the distinctive CMRL form), covered
      //    with translucent galvalume/polycarbonate panels.
      // ----------------------------------------------------------------

      // The lower Alandur Blue Line is deliberately left open above the tracks.
      // Do not create a canopy, ridge glazing, ribs, seams, lights or roof supports there.
      const omitAlandurLowerRoof = station.id === 'alandur' && corridor === 'blue';
      if (!omitAlandurLowerRoof) {
      // Continuous curved canopy: a true vaulted shell instead of stacked flat strips.
      const roofShells: THREE.BufferGeometry[] = [];
      const roofOpeningShells: THREE.BufferGeometry[] = [];
      const sideShellOuterY = PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2 + 1.3;
      const roofHalfSpan = sideShellOuterY;
      const roofRise = 2.15;
      const longitudinalSegments = 24;
      const crossSegments = 48;
      const roofVertices: number[] = [];
      const roofIndices: number[] = [];
      for (let ix = 0; ix <= longitudinalSegments; ix++) {
        const x = -halfL + (STATION_ENVELOPE_LENGTH * ix) / longitudinalSegments;
        for (let iy = 0; iy <= crossSegments; iy++) {
          const y = -roofHalfSpan + (2 * roofHalfSpan * iy) / crossSegments;
          const normalized = y / roofHalfSpan;
          // A shallow, smooth barrel vault with gently rounded eaves.
          const z = ROOF_SOFFIT_Z + roofRise * Math.sqrt(Math.max(0, 1 - normalized * normalized));
          roofVertices.push(x, y, z);
        }
      }
      for (let ix = 0; ix < longitudinalSegments; ix++) {
        for (let iy = 0; iy < crossSegments; iy++) {
          const a = ix * (crossSegments + 1) + iy;
          const b = a + crossSegments + 1;
          roofIndices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const curvedRoof = new THREE.BufferGeometry();
      curvedRoof.setAttribute('position', new THREE.Float32BufferAttribute(roofVertices, 3));
      curvedRoof.setIndex(roofIndices);
      curvedRoof.computeVertexNormals();
      roofShells.push(placeGeom(curvedRoof));

      // Translucent ridge glazing follows the same curve instead of floating as a flat slab.
      const glassVertices: number[] = [];
      const glassIndices: number[] = [];
      const glassHalfWidth = ROOF_OPENING_HALF_WIDTH;
      for (let ix = 0; ix <= longitudinalSegments; ix++) {
        const x = -halfL + (STATION_ENVELOPE_LENGTH * ix) / longitudinalSegments;
        for (let iy = 0; iy <= 12; iy++) {
          const y = -glassHalfWidth + (2 * glassHalfWidth * iy) / 12;
          const normalized = y / roofHalfSpan;
          const z = ROOF_SOFFIT_Z + roofRise * Math.sqrt(Math.max(0, 1 - normalized * normalized)) + 0.025;
          glassVertices.push(x, y, z);
        }
      }
      for (let ix = 0; ix < longitudinalSegments; ix++) {
        for (let iy = 0; iy < 12; iy++) {
          const a = ix * 13 + iy;
          const b = a + 13;
          glassIndices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const curvedGlass = new THREE.BufferGeometry();
      curvedGlass.setAttribute('position', new THREE.Float32BufferAttribute(glassVertices, 3));
      curvedGlass.setIndex(glassIndices);
      curvedGlass.computeVertexNormals();
      // Alandur's Blue Line platform has an opaque metal canopy, not the glazed
      // ridge strip used at ordinary stations. The Green Line keeps its roof glazing.
      if (!(station.id === 'alandur' && corridor === 'blue')) {
        roofOpeningShells.push(placeGeom(curvedGlass));
      }

      // Exposed steel arch ribs follow the canopy curve every 10 metres.
      for (let xr = -halfL + 3; xr <= halfL - 3; xr += 10) {
        const ribPoints: THREE.Vector3[] = [];
        for (let iy = 0; iy <= 24; iy++) {
          const y = -roofHalfSpan + (2 * roofHalfSpan * iy) / 24;
          const normalized = y / roofHalfSpan;
          const z = ROOF_SOFFIT_Z + roofRise * Math.sqrt(Math.max(0, 1 - normalized * normalized)) + 0.04;
          ribPoints.push(new THREE.Vector3(xr, y, z));
        }
        const ribCurve = new THREE.CatmullRomCurve3(ribPoints);
        const rib = new THREE.TubeGeometry(ribCurve, 48, 0.12, 6, false);
        stationTrussGeoms.push(placeGeom(rib));
      }

      // Fine longitudinal seams make the metal roof read as engineered cladding.
      for (let seamY = -roofHalfSpan + 1.0; seamY < roofHalfSpan; seamY += 1.35) {
        const normalized = seamY / roofHalfSpan;
        const seamZ = ROOF_SOFFIT_Z + roofRise * Math.sqrt(Math.max(0, 1 - normalized * normalized)) + 0.035;
        const seam = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH, 0.045, 0.045);
        seam.translate(0, seamY, seamZ);
        stationTrussGeoms.push(placeGeom(seam));
      }

      // Side roof under-lighting panels (warm LED strips above platforms)
      [-1, 1].forEach((side) => {
        const strip = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.35, 0.1);
        strip.translate(0, side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2), ROOF_SOFFIT_Z - 0.4);
        stationInteriorLightGeoms.push(placeGeom(strip));
      });

      // Add all roof shell groups
      roofShells.forEach((g) => stationRoofGeoms.push(g));
      roofOpeningShells.forEach((g) => stationRoofOpeningGeoms.push(g));
      } // end roofed-station geometry; Alandur Blue Line stays roofless

      // ----------------------------------------------------------------
      // F. SUPPORT COLUMNS (beside tracks at Y ±4.75m, roof bearing only)
      //    Columns land at the track bed and drop from roof to ground,
      //    clear of the 3.3m-wide track slab. No central columns under the
      //    lengthwise opening - the opening is roof-only (clerestory style).
      // ----------------------------------------------------------------
      if (!omitAlandurLowerRoof) [-45, -27, -9, 9, 27, 45].forEach((xF) => {
        [-1, 1].forEach((side) => {
          // At Alandur the Green Line is the upper deck above the Blue Line.
          // Its station columns must bear on the upper viaduct deck, not extend
          // down to street level through the lower Blue Line train envelope.
          const isAlandurUpperDeck = station.id === 'alandur' && corridor === 'green';
          const groundZ = isAlandurUpperDeck ? DECK_TOP_Z : -pt.z;
          const colH = ROOF_SOFFIT_Z - groundZ;
          const col = new THREE.CylinderGeometry(0.32, 0.42, colH, 16);
          col.rotateX(Math.PI / 2);
          col.translate(xF, side * 4.75, groundZ + colH / 2);
          stationBodyGeoms.push(placeGeom(col));
        });
        // Cross-head beam between left/right column pair at the end bays
        if (xF === -45 || xF === 45) {
          const beam = new THREE.BoxGeometry(1.4, 10.0, 0.7);
          beam.translate(xF, 0, ROOF_SOFFIT_Z - 0.4);
          stationTrussGeoms.push(placeGeom(beam));
        }
      });

      // ----------------------------------------------------------------
      // G. STREET-LEVEL ENTRY CORES (minimal pavilion hints at each end)
      // ----------------------------------------------------------------
      [-1, 1].forEach((side) => {
        // Alandur's main enclosed station façade replaces the generic oversized
        // entrance blocks; retain these small access pavilions at other stations only.
        if (station.id === 'alandur') return;
        // Ground-level access pavilion only. The previous full-height block
        // filled the entire gap from street to track and looked like a pillar.
        const entryZ = -pt.z;
        const coreH = 3.6;
        const core = new THREE.BoxGeometry(5.8, 4.2, coreH);
        core.translate(-halfL + 8.0, side * 9.0, entryZ + coreH / 2);
        stationBodyGeoms.push(placeGeom(core));

        const canopy = new THREE.BoxGeometry(8.0, 5.4, 0.28);
        canopy.translate(-halfL + 8.0, side * 9.0, entryZ + coreH + 0.18);
        stationRoofGeoms.push(placeGeom(canopy));

        const trim = new THREE.BoxGeometry(8.0, 0.16, 0.24);
        trim.translate(-halfL + 8.0, side * 9.0 + side * 2.5, entryZ + coreH + 0.1);
        if (corridor === 'green') stationGreenAccentGeoms.push(placeGeom(trim));
        else stationBlueAccentGeoms.push(placeGeom(trim));

        const core2 = new THREE.BoxGeometry(5.8, 4.2, coreH);
        core2.translate(halfL - 8.0, side * 9.0, entryZ + coreH / 2);
        stationBodyGeoms.push(placeGeom(core2));

        const canopy2 = new THREE.BoxGeometry(8.0, 5.4, 0.28);
        canopy2.translate(halfL - 8.0, side * 9.0, entryZ + coreH + 0.18);
        stationRoofGeoms.push(placeGeom(canopy2));

        const trim2 = new THREE.BoxGeometry(8.0, 0.16, 0.24);
        trim2.translate(halfL - 8.0, side * 9.0 + side * 2.5, entryZ + coreH + 0.1);
        if (corridor === 'green') stationGreenAccentGeoms.push(placeGeom(trim2));
        else stationBlueAccentGeoms.push(placeGeom(trim2));
      });

      // ----------------------------------------------------------------
      // H. UNDER-DECK CONCOURSE MEZZANINE SLAB (between deck top and street)
      // ----------------------------------------------------------------
      // Keep the undercroft visually open; a wide opaque mezzanine slab reads as a solid block from aerial views.
      const mezzSlab = new THREE.BoxGeometry(STATION_CLEAR_LENGTH - 24, 12.0, 0.22);
      mezzSlab.translate(0, 0, DECK_TOP_Z - 3.0);
      stationPlatformGeoms.push(placeGeom(mezzSlab));
    });

    // ---- Materials / geometry commits ----
    if (alandurFacadeGeoms.length > 0) {
      this.addMesh(mergeGeometries(alandurFacadeGeoms), this.alandurFacadeMaterial);
    }
    if (alandurGlassGeoms.length > 0) {
      this.addMesh(mergeGeometries(alandurGlassGeoms), this.alandurGlassMaterial);
    }
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
    if (stationSignGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationSignGeoms), this.stationSignMaterial);
    }
    if (stationRoofOpeningGeoms.length > 0) {
      // Translucent galvalume/polycarbonate cover over the central roof opening:
      // slightly transparent, paler than the solid roof shell so it reads correctly
      // from above but still represents the covered lengthwise opening.
      const openingMat = new THREE.MeshStandardMaterial({
        roughness: 0.55,
        metalness: 0.25,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: true,
      });
      this.addMesh(mergeGeometries(stationRoofOpeningGeoms), openingMat);
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
