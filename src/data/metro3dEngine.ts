import { CHENNAI_METRO_LINES } from './chennaiMetroData';

// -------------------------------------------------------------
// Mathematical Curve Smoothing & Aerodynamic Polyline Resampling
// -------------------------------------------------------------

/**
 * Chaikin's corner-cutting algorithm: eliminates sharp angular joints
 * by iteratively subdividing each edge into smooth quadratic B-spline curves.
 * 4 iterations produces a silky-smooth, continuous geometric curve.
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
 * Resamples a polyline at uniform metric intervals (3 meters).
 * Guarantees smooth tangent computation and equidistant pillar distribution.
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
 * Computes parallel offset polyline with smooth moving-window tangents.
 */
function offsetPolyline(coords: [number, number][], offsetMeters: number): [number, number][] {
  const n = coords.length;
  if (n < 2) return coords;
  const res: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const curr = coords[i];
    const prev = coords[Math.max(0, i - 2)];
    const next = coords[Math.min(n - 1, i + 2)];

    const latRad = (curr[1] * Math.PI) / 180;
    const metersPerDegLat = 111132;
    const metersPerDegLng = 111132 * Math.cos(latRad);

    const dx = (next[0] - prev[0]) * metersPerDegLng;
    const dy = (next[1] - prev[1]) * metersPerDegLat;
    const len = Math.hypot(dx, dy) || 1;

    const nx = -dy / len;
    const ny = dx / len;

    const dLng = (nx * offsetMeters) / metersPerDegLng;
    const dLat = (ny * offsetMeters) / metersPerDegLat;

    res.push([Number((curr[0] + dLng).toFixed(6)), Number((curr[1] + dLat).toFixed(6))]);
  }
  return res;
}

/**
 * Generates an unbroken polygonal ribbon from precomputed left and right polylines.
 * Guarantees zero gaps, zero seam misalignment, and zero block cuts.
 */
export function createRibbonFromEdges(
  leftEdge: [number, number][],
  rightEdge: [number, number][]
): [number, number][] | null {
  const n = leftEdge.length;
  if (n < 2 || rightEdge.length !== n) return null;

  return [...leftEdge, ...[...rightEdge].reverse(), leftEdge[0]];
}

/**
 * Creates rotated box polygon for piers, hammerheads, and tunnel portal arches.
 */
export function createBoxPolygon(
  center: [number, number],
  widthMeters: number,
  lengthMeters: number,
  angleRad: number
): [number, number][] {
  const latRad = (center[1] * Math.PI) / 180;
  const metersPerDegLat = 111132;
  const metersPerDegLng = 111132 * Math.cos(latRad);

  const halfW = widthMeters / 2;
  const halfL = lengthMeters / 2;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const corners = [
    [-halfL, -halfW],
    [halfL, -halfW],
    [halfL, halfW],
    [-halfL, halfW],
  ];

  const ring: [number, number][] = corners.map(([x, y]) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    const lng = center[0] + rx / metersPerDegLng;
    const lat = center[1] + ry / metersPerDegLat;
    return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
  });

  ring.push(ring[0]);
  return ring;
}

// -------------------------------------------------------------
// Core 3D Geometry Generation (Mapbox 3D Interchanges Architecture)
// Reference: https://littlepotato.me/posts/mapbox-3d-intersections/
// -------------------------------------------------------------

export interface Metro3DGeometry {
  viaductShadowGeoJSON: GeoJSON.FeatureCollection;
  viaductBoxGirderGeoJSON: GeoJSON.FeatureCollection;
  viaductDeckGeoJSON: GeoJSON.FeatureCollection;
  viaductParapetsGeoJSON: GeoJSON.FeatureCollection;
  viaductTracksGeoJSON: GeoJSON.FeatureCollection;
  viaductPillarsGeoJSON: GeoJSON.FeatureCollection;
  trenchWallsGeoJSON: GeoJSON.FeatureCollection;
  tunnelPortalsGeoJSON: GeoJSON.FeatureCollection;
  tunnelTubesGeoJSON: GeoJSON.FeatureCollection;
}

// Exact Mapbox 3D Interchanges Material Palette
export const BRIDGE_COLORS = {
  // Ground drop shadow (fake-road-shade)
  shadow: 'rgba(30, 45, 65, 0.28)',
  // Structural concrete underbelly / box girder soffit
  boxGirder: '#b8c5d6',
  // Road / bridge deck surface: exact hsl(212, 25%, 75%) from Mapbox blog post
  deckSurface: '#8fa3b8',
  // Edge parapet barrier curbs: warm architectural stone/concrete trim
  parapetCurb: '#d8d2c6',
  // Steel running rail heads (solid-lines)
  steelRail: '#ffffff',
  // Retaining walls for open-cut portal trench
  retainingWall: '#cbd5e1',
  // Support pier columns
  pierConcrete: '#94a3b8',
  // Cantilever hammerhead beam cap
  capConcrete: '#a0aec0',
  // Tunnel portal structure
  portalConcrete: '#475569',
  // Tunnel entrance void
  tunnelVoid: '#0f172a',
  // Transit identifiers
  greenAccent: '#16a34a',
  blueAccent: '#0284c7',
};

export function generateMetro3DStructures(): Metro3DGeometry {
  const viaductShadowFeatures: GeoJSON.Feature[] = [];
  const viaductBoxGirderFeatures: GeoJSON.Feature[] = [];
  const viaductDeckFeatures: GeoJSON.Feature[] = [];
  const viaductParapetsFeatures: GeoJSON.Feature[] = [];
  const viaductTrackFeatures: GeoJSON.Feature[] = [];
  const viaductPillarFeatures: GeoJSON.Feature[] = [];
  const trenchWallFeatures: GeoJSON.Feature[] = [];
  const tunnelPortalFeatures: GeoJSON.Feature[] = [];
  const tunnelTubeFeatures: GeoJSON.Feature[] = [];

  const blueLine = CHENNAI_METRO_LINES.find((l) => l.id === 'blue-line')!;
  const greenLine = CHENNAI_METRO_LINES.find((l) => l.id === 'green-line')!;

  // -------------------------------------------------------------------------
  // 1. GREEN LINE (CORRIDOR 2)
  // Total ~7141 smoothed 3m points:
  // - 0 to 3820: Level 1 Continuous Elevated Viaduct (St. Thomas Mount -> Vadapalani -> Koyambedu)
  // - 3820 to 4015: Smooth Transition Incline Ramp & Retaining Trench down into Thirumangalam Portal
  // - 4015: Thirumangalam Concrete Portal Headwall Arch
  // - 4015 to 7140: Continuous Subterranean Tunnel (Shenoy Nagar through Central)
  // -------------------------------------------------------------------------
  {
    const greenSmoothed = resamplePolyline(chaikinSmooth(greenLine.coordinates, 4), 3);

    // Precomputed transverse offsets across entire polyline:
    // Total viaduct width = 8.4m
    const boxGirderLeft = offsetPolyline(greenSmoothed, -3.8);
    const boxGirderRight = offsetPolyline(greenSmoothed, 3.8);

    const deckLeft = offsetPolyline(greenSmoothed, -4.2);
    const deckRight = offsetPolyline(greenSmoothed, 4.2);

    const parapetOuterLeft = offsetPolyline(greenSmoothed, -4.4);
    const parapetInnerLeft = offsetPolyline(greenSmoothed, -3.8);

    const parapetInnerRight = offsetPolyline(greenSmoothed, 3.8);
    const parapetOuterRight = offsetPolyline(greenSmoothed, 4.4);

    // Standard Gauge Twin Rails (1.435m gauge)
    const upRail1Left = offsetPolyline(greenSmoothed, -2.45);
    const upRail1Right = offsetPolyline(greenSmoothed, -2.25);
    const upRail2Left = offsetPolyline(greenSmoothed, -1.05);
    const upRail2Right = offsetPolyline(greenSmoothed, -0.85);

    const downRail1Left = offsetPolyline(greenSmoothed, 0.85);
    const downRail1Right = offsetPolyline(greenSmoothed, 1.05);
    const downRail2Left = offsetPolyline(greenSmoothed, 2.25);
    const downRail2Right = offsetPolyline(greenSmoothed, 2.45);

    // Center Transit Identifier Stripe
    const centerStripeLeft = offsetPolyline(greenSmoothed, -0.25);
    const centerStripeRight = offsetPolyline(greenSmoothed, 0.25);

    const tunnelLeft = offsetPolyline(greenSmoothed, -4.2);
    const tunnelRight = offsetPolyline(greenSmoothed, 4.2);

    const rampStart = 3820;
    const portalIdx = 4015;

    // Green Line Elevation Function:
    // St. Thomas Mount terminal (12.5m) -> Soaring up to 19.5m (Level 2) at Alandur Interchange over Blue Line -> Descending back to 12.5m towards Ekkattuthangal
    const getGreenElev = (idx: number): number => {
      if (idx >= 180 && idx <= 750) {
        const t = (idx - 466) / 284;
        return 12.5 + 7.0 * Math.pow(Math.cos((t * Math.PI) / 2), 2);
      }
      return 12.5;
    };

    // A. Ground Drop Shadow (fake-road-shade from Mapbox blog)
    viaductShadowFeatures.push({
      type: 'Feature',
      properties: { line_id: 'green-elev-shadow' },
      geometry: {
        type: 'LineString',
        coordinates: greenSmoothed.slice(0, rampStart + 1),
      },
    });

    // Helper to render flat elevated spans for Green Line
    const renderGreenSpan = (sIdx: number, eIdx: number, baseH: number) => {
      const gTop = baseH + 1.2;
      const dTop = baseH + 1.6;
      const pTop = baseH + 2.8;
      const rTop = dTop + 0.25;

      const bgP = createRibbonFromEdges(boxGirderLeft.slice(sIdx, eIdx + 1), boxGirderRight.slice(sIdx, eIdx + 1));
      if (bgP) {
        viaductBoxGirderFeatures.push({
          type: 'Feature',
          properties: { base_height: baseH, render_height: gTop, color: BRIDGE_COLORS.boxGirder },
          geometry: { type: 'Polygon', coordinates: [bgP] },
        });
      }

      const dP = createRibbonFromEdges(deckLeft.slice(sIdx, eIdx + 1), deckRight.slice(sIdx, eIdx + 1));
      if (dP) {
        viaductDeckFeatures.push({
          type: 'Feature',
          properties: { base_height: gTop, render_height: dTop, color: BRIDGE_COLORS.deckSurface },
          geometry: { type: 'Polygon', coordinates: [dP] },
        });
      }

      const plP = createRibbonFromEdges(parapetOuterLeft.slice(sIdx, eIdx + 1), parapetInnerLeft.slice(sIdx, eIdx + 1));
      if (plP) {
        viaductParapetsFeatures.push({
          type: 'Feature',
          properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
          geometry: { type: 'Polygon', coordinates: [plP] },
        });
      }

      const prP = createRibbonFromEdges(parapetInnerRight.slice(sIdx, eIdx + 1), parapetOuterRight.slice(sIdx, eIdx + 1));
      if (prP) {
        viaductParapetsFeatures.push({
          type: 'Feature',
          properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
          geometry: { type: 'Polygon', coordinates: [prP] },
        });
      }

      const addR = (lE: [number, number][], rE: [number, number][], color: string) => {
        const rp = createRibbonFromEdges(lE.slice(sIdx, eIdx + 1), rE.slice(sIdx, eIdx + 1));
        if (rp) {
          viaductTrackFeatures.push({
            type: 'Feature',
            properties: { base_height: dTop, render_height: rTop, color },
            geometry: { type: 'Polygon', coordinates: [rp] },
          });
        }
      };
      addR(upRail1Left, upRail1Right, BRIDGE_COLORS.steelRail);
      addR(upRail2Left, upRail2Right, BRIDGE_COLORS.steelRail);
      addR(downRail1Left, downRail1Right, BRIDGE_COLORS.steelRail);
      addR(downRail2Left, downRail2Right, BRIDGE_COLORS.steelRail);
      addR(centerStripeLeft, centerStripeRight, BRIDGE_COLORS.greenAccent);

      for (let i = sIdx; i < eIdx; i += 10) {
        const coord = greenSmoothed[i];
        const nextC = greenSmoothed[Math.min(greenSmoothed.length - 1, i + 2)];
        const prevC = greenSmoothed[Math.max(0, i - 2)];
        const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);

        const colBox = createBoxPolygon(coord, 2.4, 2.4, angle);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: baseH, color: BRIDGE_COLORS.pierConcrete },
          geometry: { type: 'Polygon', coordinates: [colBox] },
        });

        const capBox = createBoxPolygon(coord, 7.2, 2.4, angle + Math.PI / 2);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: baseH - 1.2, render_height: baseH, color: BRIDGE_COLORS.capConcrete },
          geometry: { type: 'Polygon', coordinates: [capBox] },
        });
      }
    };

    // 1. Flat Pre-Alandur (0 to 180) - St. Thomas Mount approach (12.5m)
    renderGreenSpan(0, 180, 12.5);

    // 2. Alandur Soaring Upper Deck Flyover (180 to 750) - Climbing over Blue Line up to 19.5m!
    for (let i = 180; i < 750; i++) {
      const baseH = Number(getGreenElev(i).toFixed(2));
      const gTop = Number((baseH + 1.2).toFixed(2));
      const dTop = Number((baseH + 1.6).toFixed(2));
      const pTop = Number((baseH + 2.8).toFixed(2));
      const rTop = Number((dTop + 0.25).toFixed(2));

      const bgQuad = [boxGirderLeft[i], boxGirderLeft[i + 1], boxGirderRight[i + 1], boxGirderRight[i], boxGirderLeft[i]];
      viaductBoxGirderFeatures.push({
        type: 'Feature',
        properties: { base_height: baseH, render_height: gTop, color: BRIDGE_COLORS.boxGirder },
        geometry: { type: 'Polygon', coordinates: [bgQuad] },
      });

      const dQuad = [deckLeft[i], deckLeft[i + 1], deckRight[i + 1], deckRight[i], deckLeft[i]];
      viaductDeckFeatures.push({
        type: 'Feature',
        properties: { base_height: gTop, render_height: dTop, color: BRIDGE_COLORS.deckSurface },
        geometry: { type: 'Polygon', coordinates: [dQuad] },
      });

      const plQuad = [parapetOuterLeft[i], parapetOuterLeft[i + 1], parapetInnerLeft[i + 1], parapetInnerLeft[i], parapetOuterLeft[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [plQuad] },
      });
      const prQuad = [parapetInnerRight[i], parapetInnerRight[i + 1], parapetOuterRight[i + 1], parapetOuterRight[i], parapetInnerRight[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [prQuad] },
      });

      const makeTrackQuad = (lE: [number, number][], rE: [number, number][], color: string) => {
        const q = [lE[i], lE[i + 1], rE[i + 1], rE[i], lE[i]];
        viaductTrackFeatures.push({
          type: 'Feature',
          properties: { base_height: dTop, render_height: rTop, color },
          geometry: { type: 'Polygon', coordinates: [q] },
        });
      };
      makeTrackQuad(upRail1Left, upRail1Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(upRail2Left, upRail2Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(downRail1Left, downRail1Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(downRail2Left, downRail2Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(centerStripeLeft, centerStripeRight, BRIDGE_COLORS.greenAccent);

      // Support pillars under Alandur soaring upper deck (up to 19.5m!)
      if (i % 10 === 0) {
        const coord = greenSmoothed[i];
        const nextC = greenSmoothed[Math.min(greenSmoothed.length - 1, i + 2)];
        const prevC = greenSmoothed[Math.max(0, i - 2)];
        const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);

        const colBox = createBoxPolygon(coord, 2.6, 2.6, angle);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: baseH, color: BRIDGE_COLORS.pierConcrete },
          geometry: { type: 'Polygon', coordinates: [colBox] },
        });

        const capBox = createBoxPolygon(coord, 7.4, 2.4, angle + Math.PI / 2);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: baseH - 1.3, render_height: baseH, color: BRIDGE_COLORS.capConcrete },
          geometry: { type: 'Polygon', coordinates: [capBox] },
        });
      }
    }

    // 3. Flat Post-Alandur through Ekkattuthangal to Koyambedu (750 to 3820)
    renderGreenSpan(750, rampStart, 12.5);

    // C. Transition Incline Ramp & Retaining Cut Trench (3820 to 4015)
    const rampLen = portalIdx - rampStart;
    const gDeckBase = 12.5;
    for (let i = rampStart; i < portalIdx; i++) {
      const t = (i - rampStart) / rampLen;
      const smoothT = t * t * (3 - 2 * t);
      const elev = gDeckBase * (1 - smoothT); // 12.5m down to 0m

      const isLow = elev < 2.0;
      const rBase = isLow ? 0 : Number(elev.toFixed(2));
      const rGirderTop = isLow ? Number((elev + 0.6).toFixed(2)) : Number((elev + 1.2).toFixed(2));
      const rDeckTop = isLow ? Number((elev + 0.9).toFixed(2)) : Number((elev + 1.6).toFixed(2));
      const rParaTop = isLow ? Number((elev + 1.8).toFixed(2)) : Number((elev + 2.8).toFixed(2));

      // Girder & Deck quads
      const dQuad = [deckLeft[i], deckLeft[i + 1], deckRight[i + 1], deckRight[i], deckLeft[i]];
      viaductDeckFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rDeckTop, color: BRIDGE_COLORS.deckSurface },
        geometry: { type: 'Polygon', coordinates: [dQuad] },
      });

      if (!isLow) {
        const bgQuad = [boxGirderLeft[i], boxGirderLeft[i + 1], boxGirderRight[i + 1], boxGirderRight[i], boxGirderLeft[i]];
        viaductBoxGirderFeatures.push({
          type: 'Feature',
          properties: { base_height: rBase, render_height: rGirderTop, color: BRIDGE_COLORS.boxGirder },
          geometry: { type: 'Polygon', coordinates: [bgQuad] },
        });
      }

      // Parapets / Retaining walls along ramp
      const plQuad = [parapetOuterLeft[i], parapetOuterLeft[i + 1], parapetInnerLeft[i + 1], parapetInnerLeft[i], parapetOuterLeft[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rParaTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [plQuad] },
      });
      const prQuad = [parapetInnerRight[i], parapetInnerRight[i + 1], parapetOuterRight[i + 1], parapetOuterRight[i], parapetInnerRight[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rParaTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [prQuad] },
      });

      // Twin Tracks along ramp
      const rRailTop = rDeckTop + 0.25;
      const makeRailQuad = (lE: [number, number][], rE: [number, number][], color: string) => {
        const q = [lE[i], lE[i + 1], rE[i + 1], rE[i], lE[i]];
        viaductTrackFeatures.push({
          type: 'Feature',
          properties: { base_height: rDeckTop, render_height: rRailTop, color },
          geometry: { type: 'Polygon', coordinates: [q] },
        });
      };
      makeRailQuad(upRail1Left, upRail1Right, BRIDGE_COLORS.steelRail);
      makeRailQuad(upRail2Left, upRail2Right, BRIDGE_COLORS.steelRail);
      makeRailQuad(downRail1Left, downRail1Right, BRIDGE_COLORS.steelRail);
      makeRailQuad(downRail2Left, downRail2Right, BRIDGE_COLORS.steelRail);

      // Support pillars where elevated >= 2.8m
      if (i % 10 === 0 && elev >= 2.8) {
        const coord = greenSmoothed[i];
        const nextC = greenSmoothed[Math.min(greenSmoothed.length - 1, i + 2)];
        const prevC = greenSmoothed[Math.max(0, i - 2)];
        const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);
        const pierH = Number(elev.toFixed(2));

        const colBox = createBoxPolygon(coord, 2.4, 2.4, angle);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: pierH, color: BRIDGE_COLORS.pierConcrete },
          geometry: { type: 'Polygon', coordinates: [colBox] },
        });

        const capBox = createBoxPolygon(coord, 7.2, 2.4, angle + Math.PI / 2);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: Math.max(0, pierH - 1.2), render_height: pierH, color: BRIDGE_COLORS.capConcrete },
          geometry: { type: 'Polygon', coordinates: [capBox] },
        });
      }

      // Vertical Retaining Cut Walls approaching portal (3930 to 4015) - Image 3 in user request
      if (i >= 3930) {
        const wallLeftQuad = [
          offsetPolyline(greenSmoothed, -5.2)[i],
          offsetPolyline(greenSmoothed, -5.2)[i + 1],
          offsetPolyline(greenSmoothed, -4.4)[i + 1],
          offsetPolyline(greenSmoothed, -4.4)[i],
          offsetPolyline(greenSmoothed, -5.2)[i],
        ];
        trenchWallFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: 2.4, color: BRIDGE_COLORS.retainingWall },
          geometry: { type: 'Polygon', coordinates: [wallLeftQuad] },
        });

        const wallRightQuad = [
          offsetPolyline(greenSmoothed, 4.4)[i],
          offsetPolyline(greenSmoothed, 4.4)[i + 1],
          offsetPolyline(greenSmoothed, 5.2)[i + 1],
          offsetPolyline(greenSmoothed, 5.2)[i],
          offsetPolyline(greenSmoothed, 4.4)[i],
        ];
        trenchWallFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: 2.4, color: BRIDGE_COLORS.retainingWall },
          geometry: { type: 'Polygon', coordinates: [wallRightQuad] },
        });
      }
    }

    // D. Thirumangalam Concrete Portal Headwall (4015)
    const portalCoord = greenSmoothed[portalIdx];
    if (portalCoord) {
      // Main concrete portal headwall
      const archBox = createBoxPolygon(portalCoord, 11.2, 5.8, 1.568);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 6.8, color: BRIDGE_COLORS.portalConcrete },
        geometry: { type: 'Polygon', coordinates: [archBox] },
      });
      // Dark tunnel portal mouth (track entrance)
      const mouthBox = createBoxPolygon(portalCoord, 8.8, 2.2, 1.568);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 5.2, color: BRIDGE_COLORS.tunnelVoid },
        geometry: { type: 'Polygon', coordinates: [mouthBox] },
      });
      // Parapet portal collar
      const collarBox = createBoxPolygon(portalCoord, 11.8, 6.4, 1.568);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 6.4, render_height: 7.4, color: BRIDGE_COLORS.retainingWall },
        geometry: { type: 'Polygon', coordinates: [collarBox] },
      });
    }

    // E. Subterranean Tunnel Ribbon (4015 to end)
    const tunnelPoly = createRibbonFromEdges(
      tunnelLeft.slice(portalIdx),
      tunnelRight.slice(portalIdx)
    );
    if (tunnelPoly) {
      tunnelTubeFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 0.8, color: '#111827' },
        geometry: { type: 'Polygon', coordinates: [tunnelPoly] },
      });
    }

    const tUpRail = createRibbonFromEdges(upRail1Left.slice(portalIdx), upRail2Right.slice(portalIdx));
    if (tUpRail) {
      tunnelTubeFeatures.push({
        type: 'Feature',
        properties: { base_height: 0.2, render_height: 0.9, color: BRIDGE_COLORS.greenAccent },
        geometry: { type: 'Polygon', coordinates: [tUpRail] },
      });
    }
    const tDownRail = createRibbonFromEdges(downRail1Left.slice(portalIdx), downRail2Right.slice(portalIdx));
    if (tDownRail) {
      tunnelTubeFeatures.push({
        type: 'Feature',
        properties: { base_height: 0.2, render_height: 0.9, color: BRIDGE_COLORS.greenAccent },
        geometry: { type: 'Polygon', coordinates: [tDownRail] },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. BLUE LINE (CORRIDOR 1)
  // Total ~10462 smoothed 3m points:
  // - 0 to 1340: South Elevated Viaduct (Airport -> Nanganallur Road, Base: 12.5m)
  // - 1340 to 1950: ALANDUR MULTI-TIER INTERCHANGE (Ascending to Base: 19.5m, soaring 6m OVER Green Line!)
  // - 1950 to 2720: Elevated Viaduct north of Alandur through Little Mount (Base: 12.5m)
  // - 2720 to 2880: South Ramp down into Saidapet Portal with Retaining Trench Walls
  // - 2880: Saidapet Concrete Portal Headwall
  // - 2880 to 8600: Central Subterranean Tunnel (Anna Salai through Central to Washermanpet)
  // - 8600: New Washermanpet Concrete Portal Headwall
  // - 8600 to 8760: North Ramp climbing up from New Washermanpet into Tollgate Viaduct
  // - 8760 to 10460: North Elevated Viaduct (Tollgate -> Thiruvottiyur -> Wimco Nagar Depot)
  // -------------------------------------------------------------------------
  {
    const blueSmoothed = resamplePolyline(chaikinSmooth(blueLine.coordinates, 4), 3);

    const boxGirderLeft = offsetPolyline(blueSmoothed, -3.8);
    const boxGirderRight = offsetPolyline(blueSmoothed, 3.8);

    const deckLeft = offsetPolyline(blueSmoothed, -4.2);
    const deckRight = offsetPolyline(blueSmoothed, 4.2);

    const parapetOuterLeft = offsetPolyline(blueSmoothed, -4.4);
    const parapetInnerLeft = offsetPolyline(blueSmoothed, -3.8);

    const parapetInnerRight = offsetPolyline(blueSmoothed, 3.8);
    const parapetOuterRight = offsetPolyline(blueSmoothed, 4.4);

    const upRail1Left = offsetPolyline(blueSmoothed, -2.45);
    const upRail1Right = offsetPolyline(blueSmoothed, -2.25);
    const upRail2Left = offsetPolyline(blueSmoothed, -1.05);
    const upRail2Right = offsetPolyline(blueSmoothed, -0.85);

    const downRail1Left = offsetPolyline(blueSmoothed, 0.85);
    const downRail1Right = offsetPolyline(blueSmoothed, 1.05);
    const downRail2Left = offsetPolyline(blueSmoothed, 2.25);
    const downRail2Right = offsetPolyline(blueSmoothed, 2.45);

    const centerStripeLeft = offsetPolyline(blueSmoothed, -0.25);
    const centerStripeRight = offsetPolyline(blueSmoothed, 0.25);

    const tunnelLeft = offsetPolyline(blueSmoothed, -4.2);
    const tunnelRight = offsetPolyline(blueSmoothed, 4.2);

    const southRampStart = 2720;
    const saidapetPortalIdx = 2880;
    const newWasherPortalIdx = 8260;
    const northRampEnd = 8420;

    // Blue Line stays at Level 1 (12.5m) throughout South Viaduct through Alandur!
    const getSouthElev = (_idx: number): number => 12.5;

    // A. Ground Drop Shadows along Blue Elevated Spans
    viaductShadowFeatures.push({
      type: 'Feature',
      properties: { line_id: 'blue-south-shadow' },
      geometry: {
        type: 'LineString',
        coordinates: blueSmoothed.slice(0, southRampStart + 1),
      },
    });
    viaductShadowFeatures.push({
      type: 'Feature',
      properties: { line_id: 'blue-north-shadow' },
      geometry: {
        type: 'LineString',
        coordinates: blueSmoothed.slice(northRampEnd, 10400),
      },
    });

    // B. South Elevated Section (0 to 2720):
    // 1. Flat Pre-Alandur Approach (0 to 1380)
    const renderFlatSpan = (sIdx: number, eIdx: number, baseH: number) => {
      const gTop = baseH + 1.2;
      const dTop = baseH + 1.6;
      const pTop = baseH + 2.8;
      const rTop = dTop + 0.25;

      const bgP = createRibbonFromEdges(boxGirderLeft.slice(sIdx, eIdx + 1), boxGirderRight.slice(sIdx, eIdx + 1));
      if (bgP) {
        viaductBoxGirderFeatures.push({
          type: 'Feature',
          properties: { base_height: baseH, render_height: gTop, color: BRIDGE_COLORS.boxGirder },
          geometry: { type: 'Polygon', coordinates: [bgP] },
        });
      }

      const dP = createRibbonFromEdges(deckLeft.slice(sIdx, eIdx + 1), deckRight.slice(sIdx, eIdx + 1));
      if (dP) {
        viaductDeckFeatures.push({
          type: 'Feature',
          properties: { base_height: gTop, render_height: dTop, color: BRIDGE_COLORS.deckSurface },
          geometry: { type: 'Polygon', coordinates: [dP] },
        });
      }

      const plP = createRibbonFromEdges(parapetOuterLeft.slice(sIdx, eIdx + 1), parapetInnerLeft.slice(sIdx, eIdx + 1));
      if (plP) {
        viaductParapetsFeatures.push({
          type: 'Feature',
          properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
          geometry: { type: 'Polygon', coordinates: [plP] },
        });
      }

      const prP = createRibbonFromEdges(parapetInnerRight.slice(sIdx, eIdx + 1), parapetOuterRight.slice(sIdx, eIdx + 1));
      if (prP) {
        viaductParapetsFeatures.push({
          type: 'Feature',
          properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
          geometry: { type: 'Polygon', coordinates: [prP] },
        });
      }

      const addR = (lE: [number, number][], rE: [number, number][], color: string, b: number, t: number) => {
        const rp = createRibbonFromEdges(lE.slice(sIdx, eIdx + 1), rE.slice(sIdx, eIdx + 1));
        if (rp) {
          viaductTrackFeatures.push({
            type: 'Feature',
            properties: { base_height: b, render_height: t, color },
            geometry: { type: 'Polygon', coordinates: [rp] },
          });
        }
      };
      addR(upRail1Left, upRail1Right, BRIDGE_COLORS.steelRail, dTop, rTop);
      addR(upRail2Left, upRail2Right, BRIDGE_COLORS.steelRail, dTop, rTop);
      addR(downRail1Left, downRail1Right, BRIDGE_COLORS.steelRail, dTop, rTop);
      addR(downRail2Left, downRail2Right, BRIDGE_COLORS.steelRail, dTop, rTop);
      addR(centerStripeLeft, centerStripeRight, BRIDGE_COLORS.blueAccent, dTop, dTop + 0.08);

      // Support pillars
      for (let i = sIdx; i < eIdx; i += 10) {
        const coord = blueSmoothed[i];
        const nextC = blueSmoothed[Math.min(blueSmoothed.length - 1, i + 2)];
        const prevC = blueSmoothed[Math.max(0, i - 2)];
        const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);

        const colBox = createBoxPolygon(coord, 2.4, 2.4, angle);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: baseH, color: BRIDGE_COLORS.pierConcrete },
          geometry: { type: 'Polygon', coordinates: [colBox] },
        });

        const capBox = createBoxPolygon(coord, 7.2, 2.4, angle + Math.PI / 2);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: baseH - 1.2, render_height: baseH, color: BRIDGE_COLORS.capConcrete },
          geometry: { type: 'Polygon', coordinates: [capBox] },
        });
      }
    };

    renderFlatSpan(0, 1380, 12.5);

    // 2. Alandur 4-Way Splitting & Joining Viaduct Junction (1380 to 1880, Level 1: 12.5m)
    // Replicates the authentic CMRL 4-track layout with Outer West & Outer East bifurcation!
    {
      const baseH = 12.5;
      const gTop = baseH + 1.2;
      const dTop = baseH + 1.6;
      const pTop = baseH + 2.8;
      const rTop = dTop + 0.25;

      // Central through-deck (Tracks 2 & 3)
      renderFlatSpan(1380, 1880, 12.5);

      // Calculate dynamic lateral offset for the outer bifurcation branches:
      // Fanning out from 1380 to 1500, parallel through Alandur station (1500 to 1760), and converging back from 1760 to 1880
      for (let i = 1380; i < 1880; i++) {
        let fOut = 0;
        if (i < 1500) {
          const t = (i - 1380) / 120;
          fOut = t * t * (3 - 2 * t);
        } else if (i <= 1760) {
          fOut = 1.0;
        } else {
          const t = (i - 1760) / 120;
          fOut = 1.0 - t * t * (3 - 2 * t);
        }

        const maxFlare = 5.2; // Spreads outer tracks to +/- 6.85m
        const curOffset = maxFlare * fOut;

        if (curOffset > 0.4) {
          // Outer West Track (Track 4 / Loop Up)
          const owCenter = -(1.65 + curOffset);
          const owL = offsetPolyline(blueSmoothed, owCenter - 1.8);
          const owR = offsetPolyline(blueSmoothed, owCenter + 1.8);
          const owDQuad = [owL[i], owL[i + 1], owR[i + 1], owR[i], owL[i]];
          viaductDeckFeatures.push({
            type: 'Feature',
            properties: { base_height: gTop, render_height: dTop, color: BRIDGE_COLORS.deckSurface },
            geometry: { type: 'Polygon', coordinates: [owDQuad] },
          });

          // Outer West Parapet
          const owPLOuter = offsetPolyline(blueSmoothed, owCenter - 2.0);
          const owPLInner = offsetPolyline(blueSmoothed, owCenter - 1.6);
          const owPLQuad = [owPLOuter[i], owPLOuter[i + 1], owPLInner[i + 1], owPLInner[i], owPLOuter[i]];
          viaductParapetsFeatures.push({
            type: 'Feature',
            properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
            geometry: { type: 'Polygon', coordinates: [owPLQuad] },
          });

          // Outer West Rail pair
          const owR1L = offsetPolyline(blueSmoothed, owCenter - 0.75);
          const owR1R = offsetPolyline(blueSmoothed, owCenter - 0.65);
          const owR2L = offsetPolyline(blueSmoothed, owCenter + 0.65);
          const owR2R = offsetPolyline(blueSmoothed, owCenter + 0.75);
          const owR1Quad = [owR1L[i], owR1L[i + 1], owR1R[i + 1], owR1R[i], owR1L[i]];
          const owR2Quad = [owR2L[i], owR2L[i + 1], owR2R[i + 1], owR2R[i], owR2L[i]];
          viaductTrackFeatures.push({
            type: 'Feature',
            properties: { base_height: dTop, render_height: rTop, color: BRIDGE_COLORS.steelRail },
            geometry: { type: 'Polygon', coordinates: [owR1Quad] },
          });
          viaductTrackFeatures.push({
            type: 'Feature',
            properties: { base_height: dTop, render_height: rTop, color: BRIDGE_COLORS.steelRail },
            geometry: { type: 'Polygon', coordinates: [owR2Quad] },
          });

          // Outer East Track (Track 1 / Loop Down)
          const oeCenter = +(1.65 + curOffset);
          const oeL = offsetPolyline(blueSmoothed, oeCenter - 1.8);
          const oeR = offsetPolyline(blueSmoothed, oeCenter + 1.8);
          const oeDQuad = [oeL[i], oeL[i + 1], oeR[i + 1], oeR[i], oeL[i]];
          viaductDeckFeatures.push({
            type: 'Feature',
            properties: { base_height: gTop, render_height: dTop, color: BRIDGE_COLORS.deckSurface },
            geometry: { type: 'Polygon', coordinates: [oeDQuad] },
          });

          // Outer East Parapet
          const oePROuter = offsetPolyline(blueSmoothed, oeCenter + 2.0);
          const oePRInner = offsetPolyline(blueSmoothed, oeCenter + 1.6);
          const oePRQuad = [oePRInner[i], oePRInner[i + 1], oePROuter[i + 1], oePROuter[i], oePRInner[i]];
          viaductParapetsFeatures.push({
            type: 'Feature',
            properties: { base_height: gTop, render_height: pTop, color: BRIDGE_COLORS.parapetCurb },
            geometry: { type: 'Polygon', coordinates: [oePRQuad] },
          });

          // Outer East Rail pair
          const oeR1L = offsetPolyline(blueSmoothed, oeCenter - 0.75);
          const oeR1R = offsetPolyline(blueSmoothed, oeCenter - 0.65);
          const oeR2L = offsetPolyline(blueSmoothed, oeCenter + 0.65);
          const oeR2R = offsetPolyline(blueSmoothed, oeCenter + 0.75);
          const oeR1Quad = [oeR1L[i], oeR1L[i + 1], oeR1R[i + 1], oeR1R[i], oeR1L[i]];
          const oeR2Quad = [oeR2L[i], oeR2L[i + 1], oeR2R[i + 1], oeR2R[i], oeR2L[i]];
          viaductTrackFeatures.push({
            type: 'Feature',
            properties: { base_height: dTop, render_height: rTop, color: BRIDGE_COLORS.steelRail },
            geometry: { type: 'Polygon', coordinates: [oeR1Quad] },
          });
          viaductTrackFeatures.push({
            type: 'Feature',
            properties: { base_height: dTop, render_height: rTop, color: BRIDGE_COLORS.steelRail },
            geometry: { type: 'Polygon', coordinates: [oeR2Quad] },
          });

          // Support Cantilever Straddles under the 4-track Alandur complex
          if (i % 12 === 0) {
            const coord = blueSmoothed[i];
            const nextC = blueSmoothed[Math.min(blueSmoothed.length - 1, i + 2)];
            const prevC = blueSmoothed[Math.max(0, i - 2)];
            const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);

            // Wide multi-track straddle crosshead
            const wideCap = createBoxPolygon(coord, 14.8, 2.6, angle + Math.PI / 2);
            viaductPillarFeatures.push({
              type: 'Feature',
              properties: { base_height: baseH - 1.4, render_height: baseH, color: BRIDGE_COLORS.capConcrete },
              geometry: { type: 'Polygon', coordinates: [wideCap] },
            });
          }
        }
      }
    }

    // 3. Flat Post-Alandur through Little Mount (1880 to 2720)
    renderFlatSpan(1880, southRampStart, 12.5);

    // C. South Ramp & Retaining Trench down into Saidapet Portal (2720 to 2880)
    const sRampLen = saidapetPortalIdx - southRampStart;
    for (let i = southRampStart; i < saidapetPortalIdx; i++) {
      const t = (i - southRampStart) / sRampLen;
      const smoothT = t * t * (3 - 2 * t);
      const elev = 12.5 * (1 - smoothT);

      const isLow = elev < 2.0;
      const rBase = isLow ? 0 : Number(elev.toFixed(2));
      const rGirderTop = isLow ? Number((elev + 0.6).toFixed(2)) : Number((elev + 1.2).toFixed(2));
      const rDeckTop = isLow ? Number((elev + 0.9).toFixed(2)) : Number((elev + 1.6).toFixed(2));
      const rParaTop = isLow ? Number((elev + 1.8).toFixed(2)) : Number((elev + 2.8).toFixed(2));

      const dQuad = [deckLeft[i], deckLeft[i + 1], deckRight[i + 1], deckRight[i], deckLeft[i]];
      viaductDeckFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rDeckTop, color: BRIDGE_COLORS.deckSurface },
        geometry: { type: 'Polygon', coordinates: [dQuad] },
      });

      if (!isLow) {
        const bgQuad = [boxGirderLeft[i], boxGirderLeft[i + 1], boxGirderRight[i + 1], boxGirderRight[i], boxGirderLeft[i]];
        viaductBoxGirderFeatures.push({
          type: 'Feature',
          properties: { base_height: rBase, render_height: rGirderTop, color: BRIDGE_COLORS.boxGirder },
          geometry: { type: 'Polygon', coordinates: [bgQuad] },
        });
      }

      const plQuad = [parapetOuterLeft[i], parapetOuterLeft[i + 1], parapetInnerLeft[i + 1], parapetInnerLeft[i], parapetOuterLeft[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rParaTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [plQuad] },
      });
      const prQuad = [parapetInnerRight[i], parapetInnerRight[i + 1], parapetOuterRight[i + 1], parapetOuterRight[i], parapetInnerRight[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rParaTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [prQuad] },
      });

      const rRailTop = rDeckTop + 0.25;
      const makeTrackQuad = (lE: [number, number][], rE: [number, number][], color: string) => {
        const q = [lE[i], lE[i + 1], rE[i + 1], rE[i], lE[i]];
        viaductTrackFeatures.push({
          type: 'Feature',
          properties: { base_height: rDeckTop, render_height: rRailTop, color },
          geometry: { type: 'Polygon', coordinates: [q] },
        });
      };
      makeTrackQuad(upRail1Left, upRail1Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(upRail2Left, upRail2Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(downRail1Left, downRail1Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(downRail2Left, downRail2Right, BRIDGE_COLORS.steelRail);

      if (i % 10 === 0 && elev >= 2.8) {
        const coord = blueSmoothed[i];
        const nextC = blueSmoothed[Math.min(blueSmoothed.length - 1, i + 2)];
        const prevC = blueSmoothed[Math.max(0, i - 2)];
        const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);
        const pierH = Number(elev.toFixed(2));

        const colBox = createBoxPolygon(coord, 2.4, 2.4, angle);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: pierH, color: BRIDGE_COLORS.pierConcrete },
          geometry: { type: 'Polygon', coordinates: [colBox] },
        });

        const capBox = createBoxPolygon(coord, 7.2, 2.4, angle + Math.PI / 2);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: Math.max(0, pierH - 1.2), render_height: pierH, color: BRIDGE_COLORS.capConcrete },
          geometry: { type: 'Polygon', coordinates: [capBox] },
        });
      }

      // Vertical Retaining Cut Walls approaching Saidapet Portal (2800 to 2880) - Image 3
      if (i >= 2800) {
        const wallLeftQuad = [
          offsetPolyline(blueSmoothed, -5.2)[i],
          offsetPolyline(blueSmoothed, -5.2)[i + 1],
          offsetPolyline(blueSmoothed, -4.4)[i + 1],
          offsetPolyline(blueSmoothed, -4.4)[i],
          offsetPolyline(blueSmoothed, -5.2)[i],
        ];
        trenchWallFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: 2.4, color: BRIDGE_COLORS.retainingWall },
          geometry: { type: 'Polygon', coordinates: [wallLeftQuad] },
        });

        const wallRightQuad = [
          offsetPolyline(blueSmoothed, 4.4)[i],
          offsetPolyline(blueSmoothed, 4.4)[i + 1],
          offsetPolyline(blueSmoothed, 5.2)[i + 1],
          offsetPolyline(blueSmoothed, 5.2)[i],
          offsetPolyline(blueSmoothed, 4.4)[i],
        ];
        trenchWallFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: 2.4, color: BRIDGE_COLORS.retainingWall },
          geometry: { type: 'Polygon', coordinates: [wallRightQuad] },
        });
      }
    }

    // D. Saidapet Concrete Portal Headwall (2880)
    const saidapetCoord = blueSmoothed[saidapetPortalIdx];
    if (saidapetCoord) {
      const archBox = createBoxPolygon(saidapetCoord, 11.2, 5.8, 0.912);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 6.8, color: BRIDGE_COLORS.portalConcrete },
        geometry: { type: 'Polygon', coordinates: [archBox] },
      });
      const mouthBox = createBoxPolygon(saidapetCoord, 8.8, 2.2, 0.912);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 5.2, color: BRIDGE_COLORS.tunnelVoid },
        geometry: { type: 'Polygon', coordinates: [mouthBox] },
      });
      const collarBox = createBoxPolygon(saidapetCoord, 11.8, 6.4, 0.912);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 6.4, render_height: 7.4, color: BRIDGE_COLORS.retainingWall },
        geometry: { type: 'Polygon', coordinates: [collarBox] },
      });
    }

    // E. Central Continuous Subterranean Tunnel (2880 to 8600)
    const cTunnelPoly = createRibbonFromEdges(
      tunnelLeft.slice(saidapetPortalIdx, newWasherPortalIdx + 1),
      tunnelRight.slice(saidapetPortalIdx, newWasherPortalIdx + 1)
    );
    if (cTunnelPoly) {
      tunnelTubeFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 0.8, color: '#111827' },
        geometry: { type: 'Polygon', coordinates: [cTunnelPoly] },
      });
    }

    const cUpRail = createRibbonFromEdges(upRail1Left.slice(saidapetPortalIdx, newWasherPortalIdx + 1), upRail2Right.slice(saidapetPortalIdx, newWasherPortalIdx + 1));
    if (cUpRail) {
      tunnelTubeFeatures.push({
        type: 'Feature',
        properties: { base_height: 0.2, render_height: 0.9, color: BRIDGE_COLORS.blueAccent },
        geometry: { type: 'Polygon', coordinates: [cUpRail] },
      });
    }
    const cDownRail = createRibbonFromEdges(downRail1Left.slice(saidapetPortalIdx, newWasherPortalIdx + 1), downRail2Right.slice(saidapetPortalIdx, newWasherPortalIdx + 1));
    if (cDownRail) {
      tunnelTubeFeatures.push({
        type: 'Feature',
        properties: { base_height: 0.2, render_height: 0.9, color: BRIDGE_COLORS.blueAccent },
        geometry: { type: 'Polygon', coordinates: [cDownRail] },
      });
    }

    // F. New Washermanpet Concrete Portal Headwall (8600)
    const newWasherCoord = blueSmoothed[newWasherPortalIdx];
    if (newWasherCoord) {
      const archBox = createBoxPolygon(newWasherCoord, 11.2, 5.8, 1.216);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 6.8, color: BRIDGE_COLORS.portalConcrete },
        geometry: { type: 'Polygon', coordinates: [archBox] },
      });
      const mouthBox = createBoxPolygon(newWasherCoord, 8.8, 2.2, 1.216);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 0, render_height: 5.2, color: BRIDGE_COLORS.tunnelVoid },
        geometry: { type: 'Polygon', coordinates: [mouthBox] },
      });
      const collarBox = createBoxPolygon(newWasherCoord, 11.8, 6.4, 1.216);
      tunnelPortalFeatures.push({
        type: 'Feature',
        properties: { base_height: 6.4, render_height: 7.4, color: BRIDGE_COLORS.retainingWall },
        geometry: { type: 'Polygon', coordinates: [collarBox] },
      });
    }

    // G. North Ramp climbing from New Washermanpet up to Tollgate (8600 to 8760)
    const nRampLen = northRampEnd - newWasherPortalIdx;
    for (let i = newWasherPortalIdx; i < northRampEnd; i++) {
      const t = (i - newWasherPortalIdx) / nRampLen;
      const smoothT = t * t * (3 - 2 * t);
      const elev = 12.5 * smoothT;

      const isLow = elev < 2.0;
      const rBase = isLow ? 0 : Number(elev.toFixed(2));
      const rGirderTop = isLow ? Number((elev + 0.6).toFixed(2)) : Number((elev + 1.2).toFixed(2));
      const rDeckTop = isLow ? Number((elev + 0.9).toFixed(2)) : Number((elev + 1.6).toFixed(2));
      const rParaTop = isLow ? Number((elev + 1.8).toFixed(2)) : Number((elev + 2.8).toFixed(2));

      const dQuad = [deckLeft[i], deckLeft[i + 1], deckRight[i + 1], deckRight[i], deckLeft[i]];
      viaductDeckFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rDeckTop, color: BRIDGE_COLORS.deckSurface },
        geometry: { type: 'Polygon', coordinates: [dQuad] },
      });

      if (!isLow) {
        const bgQuad = [boxGirderLeft[i], boxGirderLeft[i + 1], boxGirderRight[i + 1], boxGirderRight[i], boxGirderLeft[i]];
        viaductBoxGirderFeatures.push({
          type: 'Feature',
          properties: { base_height: rBase, render_height: rGirderTop, color: BRIDGE_COLORS.boxGirder },
          geometry: { type: 'Polygon', coordinates: [bgQuad] },
        });
      }

      const plQuad = [parapetOuterLeft[i], parapetOuterLeft[i + 1], parapetInnerLeft[i + 1], parapetInnerLeft[i], parapetOuterLeft[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rParaTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [plQuad] },
      });
      const prQuad = [parapetInnerRight[i], parapetInnerRight[i + 1], parapetOuterRight[i + 1], parapetOuterRight[i], parapetInnerRight[i]];
      viaductParapetsFeatures.push({
        type: 'Feature',
        properties: { base_height: rGirderTop, render_height: rParaTop, color: BRIDGE_COLORS.parapetCurb },
        geometry: { type: 'Polygon', coordinates: [prQuad] },
      });

      const rRailTop = rDeckTop + 0.25;
      const makeTrackQuad = (lE: [number, number][], rE: [number, number][], color: string) => {
        const q = [lE[i], lE[i + 1], rE[i + 1], rE[i], lE[i]];
        viaductTrackFeatures.push({
          type: 'Feature',
          properties: { base_height: rDeckTop, render_height: rRailTop, color },
          geometry: { type: 'Polygon', coordinates: [q] },
        });
      };
      makeTrackQuad(upRail1Left, upRail1Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(upRail2Left, upRail2Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(downRail1Left, downRail1Right, BRIDGE_COLORS.steelRail);
      makeTrackQuad(downRail2Left, downRail2Right, BRIDGE_COLORS.steelRail);

      if (i % 10 === 0 && elev >= 2.8) {
        const coord = blueSmoothed[i];
        const nextC = blueSmoothed[Math.min(blueSmoothed.length - 1, i + 2)];
        const prevC = blueSmoothed[Math.max(0, i - 2)];
        const angle = Math.atan2(nextC[1] - prevC[1], nextC[0] - prevC[0]);
        const pierH = Number(elev.toFixed(2));

        const colBox = createBoxPolygon(coord, 2.4, 2.4, angle);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: pierH, color: BRIDGE_COLORS.pierConcrete },
          geometry: { type: 'Polygon', coordinates: [colBox] },
        });

        const capBox = createBoxPolygon(coord, 7.2, 2.4, angle + Math.PI / 2);
        viaductPillarFeatures.push({
          type: 'Feature',
          properties: { base_height: Math.max(0, pierH - 1.2), render_height: pierH, color: BRIDGE_COLORS.capConcrete },
          geometry: { type: 'Polygon', coordinates: [capBox] },
        });
      }

      // Vertical Retaining Cut Walls leaving New Washermanpet (8600 to 8680)
      if (i <= 8680) {
        const wallLeftQuad = [
          offsetPolyline(blueSmoothed, -5.2)[i],
          offsetPolyline(blueSmoothed, -5.2)[i + 1],
          offsetPolyline(blueSmoothed, -4.4)[i + 1],
          offsetPolyline(blueSmoothed, -4.4)[i],
          offsetPolyline(blueSmoothed, -5.2)[i],
        ];
        trenchWallFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: 2.4, color: BRIDGE_COLORS.retainingWall },
          geometry: { type: 'Polygon', coordinates: [wallLeftQuad] },
        });

        const wallRightQuad = [
          offsetPolyline(blueSmoothed, 4.4)[i],
          offsetPolyline(blueSmoothed, 4.4)[i + 1],
          offsetPolyline(blueSmoothed, 5.2)[i + 1],
          offsetPolyline(blueSmoothed, 5.2)[i],
          offsetPolyline(blueSmoothed, 4.4)[i],
        ];
        trenchWallFeatures.push({
          type: 'Feature',
          properties: { base_height: 0, render_height: 2.4, color: BRIDGE_COLORS.retainingWall },
          geometry: { type: 'Polygon', coordinates: [wallRightQuad] },
        });
      }
    }

    // H. North Elevated Viaduct (8760 to 10400)
    renderFlatSpan(northRampEnd, 10400, 12.5);
  }

  return {
    viaductShadowGeoJSON: { type: 'FeatureCollection', features: viaductShadowFeatures },
    viaductBoxGirderGeoJSON: { type: 'FeatureCollection', features: viaductBoxGirderFeatures },
    viaductDeckGeoJSON: { type: 'FeatureCollection', features: viaductDeckFeatures },
    viaductParapetsGeoJSON: { type: 'FeatureCollection', features: viaductParapetsFeatures },
    viaductTracksGeoJSON: { type: 'FeatureCollection', features: viaductTrackFeatures },
    viaductPillarsGeoJSON: { type: 'FeatureCollection', features: viaductPillarFeatures },
    trenchWallsGeoJSON: { type: 'FeatureCollection', features: trenchWallFeatures },
    tunnelPortalsGeoJSON: { type: 'FeatureCollection', features: tunnelPortalFeatures },
    tunnelTubesGeoJSON: { type: 'FeatureCollection', features: tunnelTubeFeatures },
  };
}
