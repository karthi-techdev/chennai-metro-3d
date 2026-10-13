/* eslint-disable */
import * as fs from 'fs';

const path = 'src/components/ThreeMetroBridgeLayer.ts';
const src = fs.readFileSync(path, 'utf-8');
const lines = src.split('\n');

const startMarker = lines.findIndex((l) => l.includes('8. ELEVATED METRO STATION BUILDINGS'));
const endCommentMarker = lines.findIndex((l) => l.includes('9. ACTIVE 3D CHENNAI METRO TRAIN FLEET'));
if (startMarker < 0 || endCommentMarker < 0) throw new Error('markers not found');

// Section 8 block starts one line above the "8. ..." header as "// ===..."
const sectionStart = startMarker - 1;
// Section 9 block starts with its own "// ---..." line one line above the header
const sectionEnd = endCommentMarker - 1;

console.log('station section start (1-based):', sectionStart + 1, JSON.stringify(lines[sectionStart]));
console.log('station section end boundary (1-based):', sectionEnd + 1, JSON.stringify(lines[sectionEnd]));

const newSection = `    // =========================================================================
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

    // Real-world signature dimensions (meters)
    const STATION_CLEAR_LENGTH = 110;      // Inner clear length between portals (train fits inside)
    const STATION_ENVELOPE_LENGTH = 118;   // Total building length incl. portal frames
    const PLATFORM_WIDTH = 6.0;            // Each side platform slab width
    const PLATFORM_EDGE_Y = 2.15;          // Platform edge from each track centerline
    const DECK_TOP_Z = 1.2;                // Deck slab surface height
    const RAIL_TOP_Z = 1.42;               // Railhead / running surface
    const PLATFORM_TOP_Z = RAIL_TOP_Z + 1.10; // Platform boarding level (2.52m)
    const ROOF_SOFFIT_Z = RAIL_TOP_Z + 4.7;   // Arched roof soffit clearance above rails
    const ROOF_RIDGE_Z = RAIL_TOP_Z + 5.6;    // Arc crest at apex of arched vault

    // Roof opening strip: center gap along length, covered with translucent panels
    const ROOF_OPENING_HALF_WIDTH = 1.9;  // Half of the lengthwise central gap (total 3.8m gap)
    const ROOF_OPENING_Y = 0.0;           // Centered on track centerline X-Z plane at Y=0

    stationAnchors.forEach(({ pt, corridor }) => {
      const angle = Math.atan2(pt.ty, pt.tx);
      const placeGeom = (geom: THREE.BufferGeometry): THREE.BufferGeometry => {
        geom.rotateZ(angle);
        geom.translate(pt.x, pt.y, pt.z);
        return geom;
      };

      const halfL = STATION_ENVELOPE_LENGTH / 2;

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
      [-1, 1].forEach((xEnd) => {
        const xPos = xEnd * halfL;
        // Left + right portal columns at the ends of the envelope (beside each track)
        [-1, 1].forEach((side) => {
          const pylonH = ROOF_SOFFIT_Z - DECK_TOP_Z + 1.3;
          const pylon = new THREE.BoxGeometry(2.2, pylonH, 1.4);
          pylon.translate(
            xPos,
            side * (PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2 + 0.4),
            (ROOF_SOFFIT_Z + DECK_TOP_Z - 1.3) / 2
          );
          stationTrussGeoms.push(placeGeom(pylon));
        });
        // Portal lintel above train clearance (top of the pass-through opening)
        const lintel = new THREE.BoxGeometry(2.2, 17.0, 1.5);
        lintel.translate(xPos, 0, ROOF_SOFFIT_Z + 0.75);
        stationTrussGeoms.push(placeGeom(lintel));

        // CMRL identity fascia on outer face of lintel (green/blue corridor color)
        const fascia = new THREE.BoxGeometry(0.35, 16.4, 0.9);
        fascia.translate(xEnd * (halfL + 1.1), 0, ROOF_SOFFIT_Z + 0.75);
        if (corridor === 'green') {
          stationGreenAccentGeoms.push(placeGeom(fascia));
        } else {
          stationBlueAccentGeoms.push(placeGeom(fascia));
        }

        // End name board over the portal opening (faces arriving/departing trains)
        const endBoard = new THREE.BoxGeometry(10.0, 0.20, 1.4);
        endBoard.translate(xEnd * (halfL + 0.2), 0, ROOF_SOFFIT_Z - 2.1);
        stationSignGeoms.push(placeGeom(endBoard));

        // Dark label plate on end board (represents station name text)
        const endLabel = new THREE.BoxGeometry(9.4, 0.12, 1.25);
        endLabel.translate(xEnd * (halfL + 0.2), 0, ROOF_SOFFIT_Z - 2.1);
        stationBodyGeoms.push(placeGeom(endLabel));
      });

      // ----------------------------------------------------------------
      // E. ARCHED VAULTED ROOF with lengthwise central opening
      //    Two side roof shells over the platforms + a central opening
      //    along the roof centerline (the distinctive CMRL form), covered
      //    with translucent galvalume/polycarbonate panels.
      // ----------------------------------------------------------------

      // Side roof shells: two arched segments over each platform side
      // (modeled as parallel roof panels at Y = ±(platform_width/2 + opening_half + margin))
      const roofShells: THREE.BufferGeometry[] = [];
      const roofOpeningShells: THREE.BufferGeometry[] = [];

      // Side shell panels, descending from apex to platform edge along Y.
      // Position the outer edge of roof above the platform outer edge plus a small
      // overhang, and let the inner edge meet the lengthwise opening at Y = ±ROOF_OPENING_HALF_WIDTH.
      const sideShellOuterY = PLATFORM_EDGE_Y + PLATFORM_WIDTH / 2 + 1.3; // outer roof edge
      const sideShellInnerY = ROOF_OPENING_HALF_WIDTH + 0.15; // inner edge just outside opening

      // Roof shell panels: 3 longitudinal layers per side (so it looks like an arched form)
      const sideLayers = [
        { yOff: sideShellOuterY, widthM: 0.35, zTop: ROOF_SOFFIT_Z + 1.0 },
        { yOff: (sideShellOuterY + sideShellInnerY) / 2, widthM: 0.55, zTop: ROOF_RIDGE_Z - 0.6 },
        { yOff: sideShellInnerY, widthM: 0.7, zTop: ROOF_RIDGE_Z - 0.2 },
      ];

      [-1, 1].forEach((side) => {
        sideLayers.forEach((layer) => {
          const panel = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH + 2, layer.widthM, 0.18);
          panel.translate(0, side * layer.yOff, layer.zTop);
          roofShells.push(placeGeom(panel));
        });
      });

      // Arched transverse ribs every 12m (structural ribs over the roof opening + over side shells)
      for (let xr = -halfL + 2; xr <= halfL - 2; xr += 12) {
        const rib = new THREE.BoxGeometry(0.55, ROOF_RIDGE_Z - ROOF_SOFFIT_Z + 1.2, 0.35);
        rib.translate(xr, 0, (ROOF_SOFFIT_Z + ROOF_RIDGE_Z - 0.6) / 2 + 0.3);
        stationTrussGeoms.push(placeGeom(rib));
      }

      // Central lengthwise opening: a vertical void strip between the two side shells
      // (visual gap) - modeled as a translucent galvalume/polycarbonate cover strip
      // running the full length so the opening reads from above without being sealed glass.
      const openingCover = new THREE.BoxGeometry(STATION_ENVELOPE_LENGTH + 2, ROOF_OPENING_HALF_WIDTH * 2, 0.12);
      openingCover.translate(0, ROOF_OPENING_Y, ROOF_RIDGE_Z - 0.9);
      stationRoofOpeningGeoms.push(placeGeom(openingCover));

      // Fill the opening strip with a subtle horizontal frame (visual "covered" look)
      for (let xo = -halfL + 2; xo <= halfL - 2; xo += 6) {
        const frame = new THREE.BoxGeometry(0.08, ROOF_OPENING_HALF_WIDTH * 2, 0.06);
        frame.translate(xo, ROOF_OPENING_Y, ROOF_RIDGE_Z - 0.85);
        stationRoofOpeningGeoms.push(placeGeom(frame));
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

      // ----------------------------------------------------------------
      // F. SUPPORT COLUMNS (beside tracks at Y ±4.75m, roof bearing only)
      //    Columns land at the track bed and drop from roof to ground,
      //    clear of the 3.3m-wide track slab. No central columns under the
      //    lengthwise opening - the opening is roof-only (clerestory style).
      // ----------------------------------------------------------------
      [-45, -27, -9, 9, 27, 45].forEach((xF) => {
        [-1, 1].forEach((side) => {
          const groundZ = -pt.z;
          const colH = ROOF_SOFFIT_Z - groundZ;
          const col = new THREE.CylinderGeometry(0.55, 0.65, colH, 14);
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
        const coreH = pt.z - 1.0;
        const core = new THREE.BoxGeometry(6.0, 3.4, coreH);
        core.translate(-halfL + 3.0, side * 9.0, -pt.z + coreH / 2);
        stationBodyGeoms.push(placeGeom(core));

        const canopy = new THREE.BoxGeometry(7.0, 4.4, 0.25);
        canopy.translate(-halfL + 3.0, side * 9.0, -pt.z + 3.2);
        stationRoofGeoms.push(placeGeom(canopy));

        // Entry accent trim on canopy edge (corridor color)
        const trim = new THREE.BoxGeometry(7.0, 0.18, 0.3);
        trim.translate(-halfL + 3.0, side * 9.0 + side * 2.0, -pt.z + 3.05);
        if (corridor === 'green') {
          stationGreenAccentGeoms.push(placeGeom(trim));
        } else {
          stationBlueAccentGeoms.push(placeGeom(trim));
        }

        // Second entry core at the far end
        const core2 = new THREE.BoxGeometry(6.0, 3.4, coreH);
        core2.translate(halfL - 3.0, side * 9.0, -pt.z + coreH / 2);
        stationBodyGeoms.push(placeGeom(core2));

        const canopy2 = new THREE.BoxGeometry(7.0, 4.4, 0.25);
        canopy2.translate(halfL - 3.0, side * 9.0, -pt.z + 3.2);
        stationRoofGeoms.push(placeGeom(canopy2));

        const trim2 = new THREE.BoxGeometry(7.0, 0.18, 0.3);
        trim2.translate(halfL - 3.0, side * 9.0 + side * 2.0, -pt.z + 3.05);
        if (corridor === 'green') {
          stationGreenAccentGeoms.push(placeGeom(trim2));
        } else {
          stationBlueAccentGeoms.push(placeGeom(trim2));
        }
      });

      // ----------------------------------------------------------------
      // H. UNDER-DECK CONCOURSE MEZZANINE SLAB (between deck top and street)
      // ----------------------------------------------------------------
      const mezzSlab = new THREE.BoxGeometry(STATION_CLEAR_LENGTH - 20, 17.0, 0.5);
      mezzSlab.translate(0, 0, DECK_TOP_Z - 3.0);
      stationPlatformGeoms.push(placeGeom(mezzSlab));
    });

    // ---- Materials / geometry commits ----
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
`;

const out = lines.slice(0, sectionStart).concat(newSection.split('\n'), lines.slice(sectionEnd));
fs.writeFileSync(path, out.join('\n'), 'utf-8');
console.log('written total lines:', out.length);
