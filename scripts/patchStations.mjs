/* eslint-disable */
// One-shot codegen: extract section 8 of ThreeMetroBridgeLayer.ts (lines 845..1144 by grep
// line numbers: section 8 header at 845 = "// ====" line; section 9 header block starts at 1145)
// and replace it with the new CMRL-realistic station architecture.
import * as fs from 'fs';

const path = 'src/components/ThreeMetroBridgeLayer.ts';
const src = fs.readFileSync(path, 'utf-8');
const lines = src.split('\n');

// Locate section markers by content (robust vs line drift)
const startIdx = lines.findIndex((l) => l.includes('8. ELEVATED METRO STATION BUILDINGS')) - 1; // the "// =====" above
const fleetCommentIdx = lines.findIndex((l) => l.includes('9. ACTIVE 3D CHENNAI METRO TRAIN FLEET'));
if (startIdx < 0 || fleetCommentIdx < 0) throw new Error('markers not found');
// The fleet comment block begins with "// ------" 1 line above fleetCommentIdx
const endIdx = fleetCommentIdx - 1; // exclusive: keep the "// ---" line before section 9

// Sanity check the boundaries
console.log('start line:', startIdx + 1, JSON.stringify(lines[startIdx]));
console.log('end boundary:', endIdx + 1, JSON.stringify(lines[endIdx]));

const next = lines[startIdx - 1 + 1]; // line after "// ===" should be "// 8. ..."
console.log('first body:', JSON.stringify(next));

const newSection = `    // =========================================================================
    // 8. ELEVATED METRO STATION BUILDINGS - CHENNAI METRO PHASE-1 ARCHITECTURE
    //
    // Real CMRL elevated stations (St. Thomas Mount, Guindy, Alandur ...) are
    // single continuous vaulted-envelope buildings ~120m long that ENCLOSE both
    // tracks. Key real-world metrics implemented here:
    //   - Standard gauge 1.435m; UP/DOWN track centers at X = -1.65m / +1.65m
    //     (3.3m double-track separation), rail tops at deck + 1.42m.
    //   - Platform height 1.10m above railhead -> platform top at 2.52m.
    //   - Platform width 6.0m each side; platform edge 2.15m from track center
    //     (car-body half width 1.47m + dynamic envelope + safety margin).
    //   - FULL train length: 4 cars x 22.5m = 90.0m + coupler slack ~1.2m =
    //     91.2m total. Station clear length 110m -> a stopped consist sits
    //     ENTIRELY inside the building with >= 9m margin at each end.
    //   - Roof soffit 4.7m above railhead (3.9m tall train + OLE clearance).
    //   - Flanked facades fully glazed; vaulted steel ribs every 12m; CMRL-style
    //     yellow NAME BOARD bands over each platform and portal ends.
    //   - Station columns land beside the tracks at Y = +/-4.75m, clear of the
    //     3.3m track box; two street stair/escalator cores drop to ground.
    // =========================================================================

    const stationBodyGeoms: THREE.BufferGeometry[] = [];
    const stationRoofGeoms: THREE.BufferGeometry[] = [];
    const stationGlassGeoms: THREE.BufferGeometry[] = [];
    const stationPlatformGeoms: THREE.BufferGeometry[] = [];
    const stationTrussGeoms: THREE.BufferGeometry[] = [];
    const stationInteriorLightGeoms: THREE.BufferGeometry[] = [];
    const stationSignGeoms: THREE.BufferGeometry[] = [];
    const stationGreenAccentGeoms: THREE.BufferGeometry[] = [];
    const stationBlueAccentGeoms: THREE.BufferGeometry[] = [];

    // Real-world signature dimensions (meters)
    const STATION_CLEAR_LENGTH = 110;      // Inner clear length between portals
    const STATION_ENVELOPE_LENGTH = 118;   // Total building length incl. portals
    const PLATFORM_WIDTH = 6.0;            // Each platform slab width
    const PLATFORM_EDGE_Y = 2.15;          // Platform edge from each track centerline
    const DECK_TOP_Z = 1.2;                // Deck slab surface height
    const RAIL_TOP_Z = 1.42;               // Railhead / running surface
    const PLATFORM_TOP_Z = RAIL_TOP_Z + 1.10; // Platform boarding level (2.52m)
    const ROOF_SOFFIT_Z = RAIL_TOP_Z + 4.7;   // Roof inner clearance above rails

    stationAnchors.forEach(({ pt, corridor }) => {
      const angle = Math.atan2(pt.ty, pt.tx);
      const placeGeom = (geom: THREE.BufferGeometry): THREE.BufferGeometry => {
        geom.rotateZ(angle);
        geom.translate(pt.x, pt.y, pt.z);
        return geom;
      };

      const halfL = STATION_ENVELOPE_LENGTH / 2;

      // -------------------------------------------------------------
      // A. PLATFORM SLABS (Flanking both tracks at boarding height)
      // -------------------------------------------------------------
      [-1, 1].forEach((side) => {
        const slab = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, PLATFORM_WIDTH, 1.05);
        slab.translate(0, side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2), PLATFORM_TOP_Z - 1.05 / 2);
        stationPlatformGeoms.push(placeGeom(slab));

        // Tactile warning strip along platform edge (yellow band)
        const tactile = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.6, 0.05);
        tactile.translate(0, side * (PLATFORM_EDGE_Y + 0.3), PLATFORM_TOP_Z + 0.02);
        stationSignGeoms.push(placeGeom(tactile));

        // White platform edge safety line
        const edgeLine = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.25, 0.03);
        edgeLine.translate(0, side * (PLATFORM_EDGE_Y - 0.05), PLATFORM_TOP_Z + 0.015);
        stationSignGeoms.push(placeGeom(edgeLine));

        // Platform Screen Doors (full-height glazed barrier on the track edge)
        const psdGlass = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.1, 2.0);
        psdGlass.translate(0, side * PLATFORM_EDGE_Y, PLATFORM_TOP_Z + 1.0);
        stationGlassGeoms.push(placeGeom(psdGlass));

        // PSD sliding-door stanchion rhythm posts every 8m
        for (let d = -48; d <= 48; d += 8) {
          const psdPost = new THREE.BoxGeometry(0.12, 0.16, 2.1);
          psdPost.translate(d, side * PLATFORM_EDGE_Y, PLATFORM_TOP_Z + 1.05);
          stationTrussGeoms.push(placeGeom(psdPost));
        }

        // Facade back wall: solid spandrel + glazed upper panels
        const spandrel = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.25, 0.9);
        spandrel.translate(0, side * 6.95, PLATFORM_TOP_Z + 0.45);
        stationBodyGeoms.push(placeGeom(spandrel));

        const flankGlass = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.08, 2.6);
        flankGlass.translate(0, side * 6.95, PLATFORM_TOP_Z + 2.25);
        stationGlassGeoms.push(placeGeom(flankGlass));
      });

      // -------------------------------------------------------------
      // B. CMRL-STYLE YELLOW STATION NAME BOARDS
      //    Above each PSD level on BOTH platforms at two longitudinal spots
      //    (passenger visible from the concourse street below and platform).
      // -------------------------------------------------------------
      [-1, 1].forEach((side) => {
        [-1, 1].forEach((xSign) => {
          const board = new THREE.BoxGeometry(9.0, 0.18, 0.5);
          board.translate(xSign * 22, side * PLATFORM_EDGE_Y, PLATFORM_TOP_Z + 1.55);
          stationSignGeoms.push(placeGeom(board));
        });
      });

      // -------------------------------------------------------------
      // C. END PORTALS (Train pass-through openings, 4.0m+ tall clearance)
      // -------------------------------------------------------------
      [-1, 1].forEach((xEnd) => {
        const xPos = xEnd * halfL;
        [-1, 1].forEach((side) => {
          const pylon = new THREE.BoxGeometry(2.2, 4.4, ROOF_SOFFIT_Z - DECK_TOP_Z + 1.3);
          pylon.translate(
            xPos,
            side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH + 0.4),
            (ROOF_SOFFIT_Z + DECK_TOP_Z - 1.3) / 2
          );
          stationTrussGeoms.push(placeGeom(pylon));
        });
        // Portal lintel above train clearance
        const lintel = new THREE.BoxGeometry(2.2, 17.0, 1.5);
        lintel.translate(xPos, 0, ROOF_SOFFIT_Z + 0.75);
        stationTrussGeoms.push(placeGeom(lintel));

        // CMRL identity fascia on outer face of lintel (green/blue corridor)
        const fascia = new THREE.BoxGeometry(0.35, 16.4, 0.9);
        fascia.translate(xEnd * (halfL + 1.1), 0, ROOF_SOFFIT_Z + 0.75);
        if (corridor === 'green') {
          stationGreenAccentGeoms.push(placeGeom(fascia));
        } else {
          stationBlueAccentGeoms.push(placeGeom(fascia));
        }

        // End name board over the portal opening (faces train drivers)
        const endBoard = new THREE.BoxGeometry(0.3, 10.0, 1.4);
        endBoard.translate(xEnd * (halfL + 0.2), 0, ROOF_SOFFIT_Z - 2.1);
        stationSignGeoms.push(placeGeom(endBoard));
      });

      // -------------------------------------------------------------
      // D. VAULTED ROOF: arched transverse ribs every 12m + segmented shell
      //    descending from a raised central clerestory skylight to flanks.
      // -------------------------------------------------------------
      for (let xr = -halfL + 2; xr <= halfL - 2; xr += 12) {
        const archRib = new THREE.BoxGeometry(0.55, 14.8, 0.35);
        archRib.translate(xr, 0, ROOF_SOFFIT_Z + 1.0);
        stationTrussGeoms.push(placeGeom(archRib));
      }

      [-1, 1].forEach((side) => {
        const seg = (yOff: number, zTop: number, widthM: number) => {
          const s = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH + 2, widthM, 0.16);
          s.translate(0, side * yOff, zTop);
          stationRoofGeoms.push(placeGeom(s));
        };
        seg(7.0, ROOF_SOFFIT_Z + 0.95, 2.2);
        seg(5.0, ROOF_SOFFIT_Z + 1.35, 2.4);
        seg(3.0, ROOF_SOFFIT_Z + 1.6, 2.6);
      });
      // Central clerestory skylight strip
      const skylight = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH + 2, 3.6, 0.1);
      skylight.translate(0, 0, ROOF_SOFFIT_Z + 1.72);
      stationGlassGeoms.push(placeGeom(skylight));

      // -------------------------------------------------------------
      // E. INTERIOR PLATFORM CEILING LIGHT STRIPS (warm overhead glow)
      // -------------------------------------------------------------
      [-1, 1].forEach((side) => {
        const strip = new THREE.BoxGeometry(STATION_CLEAR_LENGTH, 0.35, 0.1);
        strip.translate(0, side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2), ROOF_SOFFIT_Z - 0.4);
        stationInteriorLightGeoms.push(placeGeom(strip));
      });

      // -------------------------------------------------------------
      // F. SUPPORT COLUMNS (beside tracks at Y +/-4.75m, roof-only bearing;
      //    drop from roof soffit to ground clear of the 3.3m track slab)
      // -------------------------------------------------------------
      [-45, -27, -9, 9, 27, 45].forEach((xF) => {
        [-1, 1].forEach((side) => {
          const groundZ = -pt.z;
          const h = ROOF_SOFFIT_Z - groundZ;
          const col = new THREE.CylinderGeometry(0.55, 0.65, h, 14);
          col.rotateX(Math.PI / 2);
          col.translate(xF, side * 4.75, groundZ + h / 2);
          stationBodyGeoms.push(placeGeom(col));
        });
        // Cross-head beam tying left/right column pairs at ends
        if (xF === -45 || xF === 45) {
          const beam = new THREE.BoxGeometry(1.4, 10.0, 0.7);
          beam.translate(xF, 0, ROOF_SOFFIT_Z - 0.4);
          stationTrussGeoms.push(placeGeom(beam));
        }
      });

      // -------------------------------------------------------------
      // G. STREET-LEVEL ENTRY CORES (Stair/Escalator vestibules)
      // -------------------------------------------------------------
      [-1, 1].forEach((side) => {
        const coreH = pt.z - 1.0;
        const core = new THREE.BoxGeometry(6.0, 3.4, coreH);
        core.translate(-18, side * 9.0, -pt.z + coreH / 2);
        stationBodyGeoms.push(placeGeom(core));

        const canopy = new THREE.BoxGeometry(7.0, 4.4, 0.25);
        canopy.translate(-18, side * 9.0, -pt.z + 3.2);
        stationRoofGeoms.push(placeGeom(canopy));

        // Entry accent trim on the canopy edge
        const trim = new THREE.BoxGeometry(7.0, 0.18, 0.3);
        trim.translate(-18, side * 9.0 + side * 2.0, -pt.z + 3.05);
        if (corridor === 'green') {
          stationGreenAccentGeoms.push(placeGeom(trim));
        } else {
          stationBlueAccentGeoms.push(placeGeom(trim));
        }
      });

      // Under-deck concourse mezzanine slab
      const mezzSlab = new THREE.BoxGeometry(STATION_CLEAR_LENGTH - 20, 17.0, 0.5);
      mezzSlab.translate(0, 0, DECK_TOP_Z - 3.0);
      stationPlatformGeoms.push(placeGeom(mezzSlab));
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
    if (stationSignGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationSignGeoms), this.stationSignMaterial);
    }
    if (stationGreenAccentGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationGreenAccentGeoms), this.greenStripeMaterial);
    }
    if (stationBlueAccentGeoms.length > 0) {
      this.addMesh(mergeGeometries(stationBlueAccentGeoms), this.blueStripeMaterial);
    }
`;

const out = lines.slice(0, startIdx).concat(newSection.split('\n'), lines.slice(endIdx));
fs.writeFileSync(path, out.join('\n'), 'utf-8');
console.log('written total lines:', out.length);
