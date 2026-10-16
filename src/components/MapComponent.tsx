'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import styles from './MapComponent.module.css';
import {
  CHENNAI_METRO_STATIONS,
  MetroStation,
} from '../data/chennaiMetroData';
import { generateMetro3DStructures } from '../data/metro3dEngine';
import { ThreeMetroBridgeLayer } from './ThreeMetroBridgeLayer';
import {
  ActiveTrainTelemetry,
  DayOfWeek,
  DAY_NAMES,
  DAY_LABELS,
  formatSecondsToHHMMSS,
  getCMRLServiceStatus,
  getCMRLServiceStatusForDay,
  getCurrentISTSeconds,
  getSystemDayOfWeek,
} from '../data/metroScheduleEngine';

const INITIAL_CENTER: [number, number] = [80.201453, 13.004256]; // Alandur 3D Viaduct Interchange
const INITIAL_ZOOM = 16.5;
const INITIAL_PITCH = 68;
const INITIAL_BEARING = 45;

export default function MapComponent() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const orbitAnimationRef = useRef<number | null>(null);
  const threeLayerRef = useRef<ThreeMetroBridgeLayer | null>(null);

  const [activeStation, setActiveStation] = useState<MetroStation>(
    CHENNAI_METRO_STATIONS.find((s) => s.id === 'alandur') || CHENNAI_METRO_STATIONS[0]
  );
  const [is3DMode, setIs3DMode] = useState<boolean>(true);
  const [isOrbiting, setIsOrbiting] = useState<boolean>(false);
  const [isFollowingTrain, setIsFollowingTrain] = useState<boolean>(false);
  const followAnimationRef = useRef<number | null>(null);
  const [showBuildings, setShowBuildings] = useState<boolean>(true);
  const [mapTheme, setMapTheme] = useState<'light' | 'dark'>('dark');
  const themeRef = useRef<'light' | 'dark'>('dark');
  const [isTrainPaused, setIsTrainPaused] = useState<boolean>(false);
  const isTrainPausedRef = useRef<boolean>(false);

  // Timetable Schedule Engine State (STRICT real-time wall-clock IST)
  const systemDay = getSystemDayOfWeek();
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(systemDay);
  const [simTimeSec, setSimTimeSec] = useState<number>(getCurrentISTSeconds());
  const [selectedTrainIndex, setSelectedTrainIndex] = useState<number>(0);
  const [trainTelemetry, setTrainTelemetry] = useState<ActiveTrainTelemetry | null>(null);
  const [serviceStatus, setServiceStatus] = useState(getCMRLServiceStatusForDay(systemDay, getCurrentISTSeconds()));
  const [activeTripIds, setActiveTripIds] = useState<string[]>([]);
  const [tripLineColors, setTripLineColors] = useState<('blue' | 'green')[]>([]);
  const [activeTrainCount, setActiveTrainCount] = useState<number>(0);

  // Telemetry state
  const [telemetry, setTelemetry] = useState({
    speed: 58,
    headway: 4,
    pitch: INITIAL_PITCH,
    bearing: INITIAL_BEARING,
    zoom: INITIAL_ZOOM,
  });

  // Helper to add all 3D bridge and tunnel layers
  const addMetro3DLayers = useCallback((map: maplibregl.Map, activeTheme?: 'light' | 'dark') => {
    const currentTheme = activeTheme ?? themeRef.current;

    // 1. Directional Sun Lighting for realistic architectural shading (neutral white to eliminate chromatic shadow tinting)
    map.setLight({
      anchor: 'viewport',
      color: '#ffffff',
      intensity: currentTheme === 'dark' ? 0.45 : 0.55,
      position: [1.15, 210, 30],
    });

    const metro3D = generateMetro3DStructures();

    const beforeBuildingId = map.getLayer('building-3d') ? 'building-3d' : undefined;

    // 2. Contact Drop Shadow directly on ground (fake-road-shade from Mapbox blog)
    if (!map.getSource('source-fake-road-shade')) {
      map.addSource('source-fake-road-shade', {
        type: 'geojson',
        data: metro3D.viaductShadowGeoJSON,
      });
      map.addLayer(
        {
          id: 'layer-fake-road-shade',
          type: 'line',
          source: 'source-fake-road-shade',
          paint: {
            'line-width': [
              'interpolate',
              ['exponential', 1.5],
              ['zoom'],
              12, 8,
              15, 22,
              18, 42
            ],
            'line-blur': [
              'interpolate',
              ['exponential', 1.5],
              ['zoom'],
              12, 4,
              15, 10,
              18, 16
            ],
            'line-color': currentTheme === 'dark' ? 'rgba(0, 0, 0, 0.55)' : 'rgba(30, 45, 65, 0.28)',
            'line-opacity': 0.85,
          },
        },
        beforeBuildingId
      );
    }

    // 3. Subterranean Underground Tunnel Tubes (at ground level)
    if (!map.getSource('source-metro-tunnels')) {
      map.addSource('source-metro-tunnels', {
        type: 'geojson',
        data: metro3D.tunnelTubesGeoJSON,
      });
      map.addLayer(
        {
          id: 'layer-metro-tunnels',
          type: 'line',
          source: 'source-metro-tunnels',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              12, 1.5,
              15, 2.5,
              18, 4,
            ],
            'line-opacity': 0.85,
          },
        },
        beforeBuildingId
      );
    }

    // 4. Continuous 3D Viaduct Geometry via Three.js Custom Layer
    // Renders deck, box girder soffit & chamfers, parapet trims, twin steel rails,
    // support piers, hammerheads, retaining walls, and tunnel portal arches
    // as smooth, unbroken, continuous 3D mathematical surfaces with ZERO blocks and ZERO steps.
    if (map.getLayer('three-metro-bridges')) {
      map.removeLayer('three-metro-bridges');
    }
    const bridgeLayer = new ThreeMetroBridgeLayer(currentTheme);
    bridgeLayer.setPaused(isTrainPausedRef.current);
    threeLayerRef.current = bridgeLayer;
    (window as unknown as { __threeLayer: unknown }).__threeLayer = bridgeLayer;
    map.addLayer(bridgeLayer);
  }, []);

  // Helper to add Station and Corridor Markers
  const addMarkers = useCallback((map: maplibregl.Map) => {
    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    CHENNAI_METRO_STATIONS.forEach((station) => {
      const markerEl = document.createElement('div');
      markerEl.className = 'apple-poi-marker';

      const badgeEl = document.createElement('div');
      badgeEl.className = `apple-poi-badge ${station.line}`;
      badgeEl.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M12 2C8 2 4 3.5 4 8v8c0 2.2 1.8 4 4 4h8c2.2 0 4-1.8 4-4V8c0-4.5-4-6-8-6zm-4 15c-.8 0-1.5-.7-1.5-1.5S7.2 14 8 14s1.5.7 1.5 1.5S8.8 17 8 17zm8 0c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5-.7 1.5-1.5 1.5zm2-6H6V8h12v3z"/>
        </svg>
      `;

      const labelEl = document.createElement('div');
      labelEl.className = 'apple-poi-label';

      const titleEl = document.createElement('div');
      titleEl.className = 'apple-poi-title';
      titleEl.textContent = station.name;

      const subEl = document.createElement('div');
      subEl.className = 'apple-poi-sub';
      subEl.textContent = `${station.type} • ${station.line.toUpperCase()}`;

      labelEl.appendChild(titleEl);
      labelEl.appendChild(subEl);
      markerEl.appendChild(badgeEl);
      markerEl.appendChild(labelEl);

      markerEl.addEventListener('click', () => {
        setActiveStation(station);
        map.flyTo({
          center: station.coordinates,
          zoom: 16.8,
          pitch: 68,
          duration: 1800,
        });
      });

      const marker = new maplibregl.Marker({ element: markerEl })
        .setLngLat(station.coordinates)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Corridor Route Shields
    const shieldBlueEl = document.createElement('div');
    shieldBlueEl.className = 'corridor-shield';
    shieldBlueEl.innerHTML = `<span>CMRL</span><strong>1</strong>`;
    shieldBlueEl.title = 'Corridor 1: Blue Line';
    const blueMarker = new maplibregl.Marker({ element: shieldBlueEl })
      .setLngLat([80.2690, 13.0680])
      .addTo(map);
    markersRef.current.push(blueMarker);

    const shieldGreenEl = document.createElement('div');
    shieldGreenEl.className = 'corridor-shield green';
    shieldGreenEl.innerHTML = `<span>CMRL</span><strong>2</strong>`;
    shieldGreenEl.title = 'Corridor 2: Green Line';
    const greenMarker = new maplibregl.Marker({ element: shieldGreenEl })
      .setLngLat([80.2460, 13.0781])
      .addTo(map);
    markersRef.current.push(greenMarker);
  }, []);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Configure the MapLibre web worker for Next.js
    maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');

    // Default to Mapbox 3D Clean Dark Theme
    const styleUrl = '/styles/mapbox-3d-dark.json';

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: INITIAL_PITCH,
      bearing: INITIAL_BEARING,
      maxPitch: 85,
    });

    mapRef.current = map;
    (window as unknown as { __map: unknown }).__map = map;

    map.on('error', (err) => {
      console.warn('MapLibre event:', err);
    });

    // Controls
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');

    let moveThrottle: number | null = null;
    map.on('move', () => {
      if (moveThrottle !== null) return;
      moveThrottle = requestAnimationFrame(() => {
        moveThrottle = null;
        const p = Math.round(map.getPitch());
        const b = Math.round(map.getBearing());
        const z = Number(map.getZoom().toFixed(1));
        setTelemetry((prev) => {
          if (prev.pitch === p && prev.bearing === b && prev.zoom === z) return prev;
          return { ...prev, pitch: p, bearing: b, zoom: z };
        });
      });
    });

    map.on('load', () => {
      addMetro3DLayers(map);
      addMarkers(map);
    });

    return () => {
      if (orbitAnimationRef.current) {
        cancelAnimationFrame(orbitAnimationRef.current);
      }
      if (followAnimationRef.current) {
        cancelAnimationFrame(followAnimationRef.current);
      }
      map.remove();
    };
  }, []); // Run once on mount: prevent tearing down map on theme toggle

  // Toggle Theme (Mapbox 3D Clean Light <-> Dark)
  const toggleTheme = () => {
    const nextTheme = themeRef.current === 'light' ? 'dark' : 'light';
    themeRef.current = nextTheme;
    setMapTheme(nextTheme);
    if (!mapRef.current) return;

    // Immediately update Three.js theme materials
    threeLayerRef.current?.setTheme(nextTheme);

    const nextStyleUrl = nextTheme === 'light' ? '/styles/mapbox-3d-light.json' : '/styles/mapbox-3d-dark.json';
    mapRef.current.setStyle(nextStyleUrl);
    mapRef.current.once('style.load', () => {
      if (mapRef.current) {
        addMetro3DLayers(mapRef.current, nextTheme);
        addMarkers(mapRef.current);
      }
    });
  };

  // Fly to Station
  const handleFlyToStation = (station: MetroStation) => {
    setActiveStation(station);
    if (!mapRef.current) return;

    mapRef.current.flyTo({
      center: station.coordinates,
      zoom: 16.8,
      pitch: is3DMode ? 68 : 0,
      bearing: mapRef.current.getBearing() + 10,
      essential: true,
      duration: 1800,
    });
  };

  // Toggle 3D Perspective vs 2D Top-Down
  const toggle3DMode = () => {
    if (!mapRef.current) return;
    const nextMode = !is3DMode;
    setIs3DMode(nextMode);

    mapRef.current.easeTo({
      pitch: nextMode ? 68 : 0,
      duration: 1200,
    });
  };

  // Orbit camera loop
  const toggleOrbit = useCallback(() => {
    if (!mapRef.current) return;

    if (isFollowingTrain) {
      if (followAnimationRef.current) {
        cancelAnimationFrame(followAnimationRef.current);
        followAnimationRef.current = null;
      }
      setIsFollowingTrain(false);
    }

    if (isOrbiting) {
      if (orbitAnimationRef.current) {
        cancelAnimationFrame(orbitAnimationRef.current);
        orbitAnimationRef.current = null;
      }
      setIsOrbiting(false);
    } else {
      setIsOrbiting(true);
      const orbit = () => {
        if (!mapRef.current) return;
        const currentBearing = mapRef.current.getBearing();
        mapRef.current.setBearing(currentBearing + 0.12);
        orbitAnimationRef.current = requestAnimationFrame(orbit);
      };
      orbit();
    }
  }, [isOrbiting, isFollowingTrain]);

  // Chase Camera Loop following Metro Train in Real-Time
  const toggleFollowTrain = useCallback(() => {
    if (!mapRef.current) return;

    if (isFollowingTrain) {
      if (followAnimationRef.current) {
        cancelAnimationFrame(followAnimationRef.current);
        followAnimationRef.current = null;
      }
      setIsFollowingTrain(false);
    } else {
      setIsFollowingTrain(true);
      if (isOrbiting) {
        if (orbitAnimationRef.current) {
          cancelAnimationFrame(orbitAnimationRef.current);
          orbitAnimationRef.current = null;
        }
        setIsOrbiting(false);
      }

      const follow = () => {
        if (!mapRef.current) return;
        const layer = (mapRef.current as any).style?._layers?.['three-metro-bridges']?.implementation;
        if (layer?.trainFleet?.trains?.[selectedTrainIndex]) {
          const train = layer.trainFleet.trains[selectedTrainIndex];
          const pos = train.cars[0].group.position;
          const oMerc = layer.originMerc;
          const scale = layer.meterScale;
          const mx = oMerc.x + pos.x * scale;
          const my = oMerc.y + pos.y * scale;
          const lng = mx * 360 - 180;
          const lat = (Math.atan(Math.exp((0.5 - my) * 2 * Math.PI)) * 2 - Math.PI / 2) * 180 / Math.PI;
          const heading = (train.cars[0].group.rotation.z * 180 / Math.PI) - 30;

          mapRef.current.jumpTo({
            center: [lng, lat],
            zoom: 20.2,
            pitch: 70,
            bearing: heading,
          });
        }
        followAnimationRef.current = requestAnimationFrame(follow);
      };
      follow();
    }
  }, [isFollowingTrain, isOrbiting, selectedTrainIndex]);

  // Toggle Pause/Resume Metro Train Movements
  const togglePauseTrains = useCallback(() => {
    setIsTrainPaused((prev) => {
      const next = !prev;
      isTrainPausedRef.current = next;
      threeLayerRef.current?.setPaused(next);
      return next;
    });
  }, []);

  // Periodic poll of real-time clock, service status, and train telemetry (optimized to prevent redundant re-renders)
  useEffect(() => {
    let lastSec = -1;
    let lastRosterSignature = '';

    const timer = setInterval(() => {
      const layer = threeLayerRef.current;
      if (!layer?.trainFleet) return;
      const t = layer.trainFleet.getSimTime();
      const currentIntSec = Math.floor(t);

      // Only re-render clock and service badge when the integer second advances
      if (currentIntSec !== lastSec) {
        lastSec = currentIntSec;
        setSimTimeSec(t);
        setServiceStatus(getCMRLServiceStatusForDay(selectedDay, t));
      }

      const tel = layer.trainFleet.getPrimaryTrainTelemetry(selectedTrainIndex);
      setTrainTelemetry(tel);

      // Live trip roster for the selector strip - only update state if roster actually changes
      const telemetries = layer.trainFleet
        .getFleetTelemetry()
        .filter((x): x is ActiveTrainTelemetry => x !== null);
      const rosterSig = telemetries.map((x) => x.tripId).join(',');
      if (rosterSig !== lastRosterSignature) {
        lastRosterSignature = rosterSig;
        setActiveTripIds(telemetries.map((x) => x.tripId));
        setTripLineColors(telemetries.map((x) => x.line));
        setActiveTrainCount(telemetries.length);
        if (selectedTrainIndex >= telemetries.length && telemetries.length > 0) {
          setSelectedTrainIndex(0);
        }
      }
    }, 200);
    return () => clearInterval(timer);
  }, [selectedTrainIndex, selectedDay]);

  const handleSelectDay = (day: DayOfWeek) => {
    setSelectedDay(day);
    threeLayerRef.current?.setSelectedDay(day);
    setServiceStatus(getCMRLServiceStatusForDay(day, simTimeSec));
  };

  const handleSelectTrain = (index: number) => {
    setSelectedTrainIndex(index);
    const tel = threeLayerRef.current?.trainFleet?.getPrimaryTrainTelemetry(index);
    setTrainTelemetry(tel || null);
  };

  // Toggle 3D Buildings Visibility
  const toggleBuildings = () => {
    const nextState = !showBuildings;
    setShowBuildings(nextState);
    if (!mapRef.current) return;

    const bldgLayerId = 'building-3d';
    if (mapRef.current.getLayer(bldgLayerId)) {
      mapRef.current.setLayoutProperty(
        bldgLayerId,
        'visibility',
        nextState ? 'visible' : 'none'
      );
    }
  };

  return (
    <div className={styles.mapWrapper}>
      {/* 3D Map Viewport */}
      <div ref={mapContainerRef} className={styles.mapContainer} />

      {/* Top Station Bookmarks Bar */}
      <div className={styles.topStationBar} role="navigation">
        {CHENNAI_METRO_STATIONS.map((station) => (
          <button
            key={station.id}
            className={`${styles.stationPill} ${
              activeStation.id === station.id ? styles.active : ''
            }`}
            onClick={() => handleFlyToStation(station)}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background:
                  station.line === 'blue'
                    ? '#0284c7'
                    : station.line === 'green'
                    ? '#16a34a'
                    : '#f59e0b',
              }}
            />
            {station.name.split('(')[0].trim()}
          </button>
        ))}
      </div>

      {/* Timetable Schedule Engine & Clock Bar */}
      <div className={styles.timetableBar} role="region" aria-label="Timetable Schedule Controls">
        <div className={styles.timetableHeader}>
          <div className={styles.digitalClockWrapper}>
            <span
              className={styles.livePulseDot}
              style={{
                background: '#22c55e',
                boxShadow: '0 0 10px #22c55e',
              }}
            />
            <span className={styles.digitalClock}>{formatSecondsToHHMMSS(simTimeSec)}</span>
            <span className={styles.clockTz}>IST</span>
          </div>

          <div
            className={`${styles.serviceBadge} ${
              serviceStatus.badgeType === 'peak'
                ? styles.badgePeak
                : serviceStatus.badgeType === 'regular'
                ? styles.badgeRegular
                : serviceStatus.badgeType === 'late'
                ? styles.badgeLate
                : styles.badgeClosed
            }`}
          >
            {serviceStatus.statusText}
          </div>
        </div>

        {/* Day-of-Week Schedule Selector (Monday to Sunday) */}
        <div className={styles.dayStrip}>
          {(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as DayOfWeek[]).map((day) => {
            const isToday = day === systemDay;
            const isSel = day === selectedDay;
            return (
              <button
                key={day}
                className={`${styles.dayPill} ${isSel ? styles.active : ''}`}
                onClick={() => handleSelectDay(day)}
                title={`${DAY_LABELS[day]} Schedule Operations`}
              >
                <span>{day}</span>
                {isToday && <span className={styles.dayTodayBadge}>TODAY</span>}
              </button>
            );
          })}
        </div>

        {/* Strictly Real-Time (wall-clock IST): no multiplier, no scrubber, no presets */}
        <div className={styles.timeControlsRow}>
          <span
            className={styles.timeButton}
            title="Clock is locked to real-world Indian Standard Time — trains run exactly on schedule"
          >
            ⏱️ Real-Time ONLY — all trains tracked live by official CMRL timetable
          </span>
        </div>

        {/* Live Train Selector Strip (all active trains on network, by trip) */}
        <div className={styles.fleetStrip}>
          {trainTelemetry && (
            <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 11, alignSelf: 'center', paddingRight: 6 }}>
              {activeTrainCount} trains live
            </span>
          )}
          {activeTripIds.map((tripId, idx) => (
            <button
              key={tripId}
              className={`${styles.trainPill} ${tripLineColors[idx] === 'green' ? styles.green : ''} ${
                selectedTrainIndex === idx ? styles.active : ''
              }`}
              onClick={() => handleSelectTrain(idx)}
              title={`Track and follow ${tripId}`}
            >
              <span>{tripLineColors[idx] === 'green' ? '🟢' : '🔵'}</span>
              <span>{tripId}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Floating Navigation Controls */}
      <aside className={styles.floatingControls}>
        <button
          className={styles.actionPillButton}
          onClick={() => {
            mapRef.current?.flyTo({
              center: [80.201453, 13.004256],
              zoom: 17.6,
              pitch: 70,
              bearing: 40,
              duration: 2000,
            });
          }}
          title="Green Line on Top (Level 2), Blue Line Below (Level 1)"
        >
          🌉 3D Interchange (Alandur)
        </button>
        <button
          className={styles.actionPillButton}
          onClick={() => {
            mapRef.current?.flyTo({
              center: [80.2015, 13.0035],
              zoom: 17.2,
              pitch: 18,
              bearing: 25,
              duration: 2000,
            });
          }}
          title="Top view of multi-level Alandur interchange (Green Line soaring over Blue Line)"
        >
          🛰️ Alandur Interchange (Top View)
        </button>
        <button
          className={styles.actionPillButton}
          onClick={() => {
            mapRef.current?.flyTo({
              center: [80.198303, 13.0812],
              zoom: 17.5,
              pitch: 74,
              bearing: 175,
              duration: 2000,
            });
          }}
        >
          🛣️ Elevated Ramp (Koyambedu)
        </button>
        <button
          className={styles.actionPillButton}
          onClick={() => {
            mapRef.current?.flyTo({
              center: [80.2251, 13.0172],
              zoom: 17.6,
              pitch: 72,
              bearing: 30,
              duration: 2000,
            });
          }}
        >
          🚇 Retaining Trench (Saidapet)
        </button>
        <button
          className={styles.actionPillButton}
          onClick={() => {
            mapRef.current?.flyTo({
              center: [80.273922, 13.081688],
              zoom: 16.8,
              pitch: 70,
              bearing: -15,
              duration: 2000,
            });
          }}
        >
          🚇 Subterranean Tunnel (Central)
        </button>
        <button
          className={`${styles.actionPillButton} ${mapTheme === 'dark' ? styles.active : ''}`}
          onClick={toggleTheme}
          title="Toggle between Dark and Light mode"
        >
          {mapTheme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}
        </button>
        <button
          className={`${styles.actionPillButton} ${is3DMode ? styles.active : ''}`}
          onClick={toggle3DMode}
        >
          {is3DMode ? '3D View: 68°' : '2D Plan'}
        </button>
        <button
          className={`${styles.actionPillButton} ${isFollowingTrain ? styles.active : ''}`}
          onClick={toggleFollowTrain}
          title="Attach cinematic chase camera to follow selected metro train"
        >
          {isFollowingTrain ? '⏹️ Stop Following' : '🚆 Follow Train'}
        </button>
        <button
          className={`${styles.actionPillButton} ${isTrainPaused ? styles.paused : ''}`}
          onClick={togglePauseTrains}
          title={isTrainPaused ? 'Resume metro train movements' : 'Pause metro train movements'}
        >
          {isTrainPaused ? '▶️ Resume Trains' : '⏸️ Pause Trains'}
        </button>
        <button
          className={`${styles.actionPillButton} ${isOrbiting ? styles.active : ''}`}
          onClick={toggleOrbit}
        >
          {isOrbiting ? 'Stop Orbit' : 'Orbit 360°'}
        </button>
        <button
          className={`${styles.actionPillButton} ${showBuildings ? styles.active : ''}`}
          onClick={toggleBuildings}
        >
          3D Buildings: {showBuildings ? 'ON' : 'OFF'}
        </button>
      </aside>

      {/* Bottom Telemetry Navigation Capsule */}
      <footer className={styles.bottomNavCapsule}>
        <div className={styles.capsuleItem}>
          <div className={styles.capsuleValue}>
            {isTrainPaused ? 0 : (trainTelemetry?.speedKmh ?? 0)}
          </div>
          <div className={styles.capsuleLabel}>{isTrainPaused ? 'PAUSED' : 'KM/H SPEED'}</div>
          {trainTelemetry?.motionState && (
            <div
              className={`${styles.statusBadge} ${
                trainTelemetry.motionState === 'DWELLING'
                  ? styles.statusDwelling
                  : trainTelemetry.motionState === 'ACCELERATING'
                  ? styles.statusAccel
                  : trainTelemetry.motionState === 'CRUISING'
                  ? styles.statusCruise
                  : styles.statusBrake
              }`}
            >
              {trainTelemetry.motionState === 'DWELLING'
                ? `DOORS OPEN (${trainTelemetry.dwellRemainingSec}s)`
                : trainTelemetry.motionState}
            </div>
          )}
        </div>

        <div className={styles.capsuleDivider} />

        <div className={styles.capsuleItem}>
          <div className={styles.capsuleValue} style={{ fontSize: 13, fontWeight: 700, maxWidth: 220, textAlign: 'center', lineHeight: 1.25 }}>
            {trainTelemetry?.currentStation || 'Station'} ➔ {trainTelemetry?.nextStation || 'Next Station'}
          </div>
          <div className={styles.capsuleLabel}>
            {trainTelemetry?.motionState === 'DWELLING'
              ? `PLATFORM STOP • ${trainTelemetry?.elevationType || 'Station'}`
              : `ETA: ${trainTelemetry?.etaNextStationSec ?? 0}s • ${trainTelemetry?.elevationType || 'Transit'}`}
          </div>
        </div>

        <div className={styles.capsuleDivider} />

        <div className={styles.capsuleItem}>
          <div className={styles.capsuleValue}>
            {serviceStatus.headwayMinutes > 0 ? `${serviceStatus.headwayMinutes}m` : '--'}
          </div>
          <div className={styles.capsuleLabel}>HEADWAY</div>
        </div>

        <div className={styles.capsuleDivider} />

        <div className={styles.capsuleItem}>
          <div className={styles.capsuleValue}>{telemetry.pitch}°</div>
          <div className={styles.capsuleLabel}>TILT</div>
        </div>

        <div className={styles.capsuleDivider} />

        <div className={styles.capsuleItem}>
          <div className={styles.capsuleValue}>{telemetry.bearing}°</div>
          <div className={styles.capsuleLabel}>HEADING</div>
        </div>
      </footer>
    </div>
  );
}
