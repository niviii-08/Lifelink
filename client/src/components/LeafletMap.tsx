import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Emergency, Hospital, BloodBank, Camp, DonorSearchResult } from '../api';
import { COIMBATORE_CENTER, type Coordinates } from '../utils/geo';

export type MarkerType = 'hospital' | 'bloodBank' | 'camp' | 'emergency' | 'donor';
export type SelectedMarker = { type: MarkerType; id: string } | null;

interface LeafletMapProps {
  emergencies: Emergency[];
  /** Privacy-safe donor results only — approxLat/approxLng, never exact coordinates. */
  donors?: DonorSearchResult[];
  hospitals?: Hospital[];
  bloodBanks?: BloodBank[];
  camps?: Camp[];
  /** When a blood-group search is active, these bank IDs get a highlighted marker style. */
  highlightedBankIds?: string[];
  /** Real (or fallback) location of the person viewing the map. Defaults to Coimbatore city center. */
  userLocation?: Coordinates;
  /** When set, draws a visible circle showing the active search radius around the user location. */
  radiusKm?: number | null;
  filters: {
    donors: boolean;
    hospitals: boolean;
    bloodBanks: boolean;
    emergencies: boolean;
    camps: boolean;
  };
  activeDirections: {
    destLat: number;
    destLng: number;
    destName: string;
    emergencyId: string;
  } | null;
  /** List item selected from the sidebar — map flies to it and opens its popup. */
  selectedMarker?: SelectedMarker;
  onSelectEmergency?: (emerg: Emergency) => void;
  /** Fired when ANY marker is clicked, so the sidebar list can highlight it back. */
  onSelectMarker?: (sel: SelectedMarker) => void;
  onRouteGenerated?: (routeInfo: { distance: string; duration: string; steps: string[] }) => void;
}

export const LeafletMap: React.FC<LeafletMapProps> = ({
  emergencies,
  donors = [],
  hospitals = [],
  bloodBanks = [],
  camps = [],
  highlightedBankIds = [],
  userLocation = COIMBATORE_CENTER,
  radiusKm = null,
  filters,
  activeDirections,
  selectedMarker,
  onSelectEmergency,
  onSelectMarker,
  onRouteGenerated
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const userLoc: [number, number] = [userLocation.lat, userLocation.lng];
  const userLocRef = useRef(userLoc);
  userLocRef.current = userLoc;
  const userMarkerRef = useRef<L.CircleMarker | null>(null);
  const userRadiusRef = useRef<L.Circle | null>(null);

  // Layer groups refs
  const donorLayerRef = useRef<L.LayerGroup | null>(null);
  const hospitalLayerRef = useRef<L.LayerGroup | null>(null);
  const bbLayerRef = useRef<L.LayerGroup | null>(null);
  const campLayerRef = useRef<L.LayerGroup | null>(null);
  const emergencyLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);

  // Every clickable marker, keyed "type-id", so a sidebar click can fly-to + open its popup.
  const markerIndexRef = useRef<Map<string, L.CircleMarker>>(new Map());

  const markerStyle = (fillColor: string) => ({
    radius: 7,
    fillColor: fillColor,
    color: '#ffffff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.95
  });

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const initializedMap = L.map(mapContainerRef.current, {
      zoomControl: true,
      minZoom: 9,
      maxZoom: 18
    }).setView(userLoc, 13);

    // Dark aesthetics layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(initializedMap);

    // User Location Indicator (position kept in sync by the effect below once real geolocation resolves)
    userMarkerRef.current = L.circleMarker(userLocRef.current, {
      radius: 9,
      fillColor: '#3b82f6',
      color: '#ffffff',
      weight: 3,
      opacity: 1,
      fillOpacity: 0.95
    }).addTo(initializedMap).bindPopup('<strong>📍 Your Location</strong>');

    // Create and add layer groups
    donorLayerRef.current = L.layerGroup().addTo(initializedMap);
    hospitalLayerRef.current = L.layerGroup().addTo(initializedMap);
    bbLayerRef.current = L.layerGroup().addTo(initializedMap);
    campLayerRef.current = L.layerGroup().addTo(initializedMap);
    emergencyLayerRef.current = L.layerGroup().addTo(initializedMap);
    routeLayerRef.current = L.layerGroup().addTo(initializedMap);

    mapRef.current = initializedMap;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Keep the "Your Location" marker + map center in sync once real geolocation resolves
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userMarkerRef.current) return;
    userMarkerRef.current.setLatLng(userLoc);
    map.setView(userLoc, map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation.lat, userLocation.lng]);

  // Draw/update the visible search-radius circle around the user location
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userRadiusRef.current) {
      map.removeLayer(userRadiusRef.current);
      userRadiusRef.current = null;
    }
    if (radiusKm && radiusKm > 0) {
      userRadiusRef.current = L.circle(userLoc, {
        radius: radiusKm * 1000,
        color: '#3b82f6',
        weight: 1.5,
        opacity: 0.6,
        fillColor: '#3b82f6',
        fillOpacity: 0.06,
        dashArray: '6, 6'
      }).addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radiusKm, userLocation.lat, userLocation.lng]);

  // Update Markers based on data & filters
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerIndexRef.current.clear();

    const registerMarker = (type: MarkerType, id: string, marker: L.CircleMarker) => {
      markerIndexRef.current.set(`${type}-${id}`, marker);
      if (onSelectMarker) marker.on('click', () => onSelectMarker({ type, id }));
    };

    // 1. Donors — PRIVACY-SAFE: approximate coordinates only, masked display name,
    //    only donors marked Active (i.e. opted into availability) are ever plotted.
    const donorLayer = donorLayerRef.current;
    if (donorLayer) {
      donorLayer.clearLayers();
      if (filters.donors) {
        donors
          .filter((d) => d.approxLat != null && d.approxLng != null && d.status === 'Active')
          .forEach((d) => {
            const m = L.circleMarker([d.approxLat as number, d.approxLng as number], { ...markerStyle('#e74c3c'), radius: 6 })
              .addTo(donorLayer)
              .bindPopup(
                `<strong>👤 ${d.displayName} (${d.bloodGroup})</strong><br>Approx. area: ${d.location}` +
                `<br><span style="font-size:11px;opacity:.75">Exact location hidden for donor privacy</span>`
              );
            registerMarker('donor', d.id, m);
          });
      }
    }

    // 2. Hospitals (real hospital records)
    const hospLayer = hospitalLayerRef.current;
    if (hospLayer) {
      hospLayer.clearLayers();
      if (filters.hospitals) {
        hospitals
          .filter((h) => h.lat != null && h.lng != null)
          .forEach((h) => {
            const m = L.circleMarker([h.lat as number, h.lng as number], { ...markerStyle('#3b82f6'), radius: 9 })
              .addTo(hospLayer)
              .bindPopup(`<strong>🏥 ${h.name}</strong><br>${h.location} · ${h.status}<br>Quota: ${h.quotaUsed}/${h.quotaLimit} used · ${h.activeEmergencies} active request(s)`);
            registerMarker('hospital', h.id, m);
          });
      }
    }

    // 3. Blood Banks (real blood bank records — highlighted style if matched by an active search)
    const bbLayer = bbLayerRef.current;
    if (bbLayer) {
      bbLayer.clearLayers();
      if (filters.bloodBanks) {
        bloodBanks
          .filter((b) => b.lat != null && b.lng != null)
          .forEach((b) => {
            const isHighlighted = highlightedBankIds.includes(b.id);
            const style = isHighlighted
              ? { ...markerStyle('#facc15'), radius: 11, weight: 3 }
              : { ...markerStyle('#10b981'), radius: 8 };
            const m = L.circleMarker([b.lat as number, b.lng as number], style)
              .addTo(bbLayer)
              .bindPopup(`<strong>🩸 ${b.name}</strong><br>${b.address || b.name} · ${b.apiStatus}<br>${b.stock} units total in stock`);
            registerMarker('bloodBank', b.id, m);
          });
      }
    }

    // 4. Donation Camps
    const campLayer = campLayerRef.current;
    if (campLayer) {
      campLayer.clearLayers();
      if (filters.camps) {
        camps
          .filter((c) => c.lat != null && c.lng != null && c.status !== 'Under Review' && c.status !== 'Rejected')
          .forEach((c) => {
            const m = L.circleMarker([c.lat as number, c.lng as number], { ...markerStyle('#a855f7'), radius: 8 })
              .addTo(campLayer)
              .bindPopup(`<strong>🏕️ ${c.title}</strong><br>${c.location} · ${c.date}<br>${c.registered}/${c.limit} registered · ${c.status}`);
            registerMarker('camp', c.id, m);
          });
      }
    }

    // 5. Emergencies
    const emergLayer = emergencyLayerRef.current;
    if (emergLayer) {
      emergLayer.clearLayers();
      if (filters.emergencies) {
        emergencies.forEach((e) => {
          const m = L.circleMarker([e.lat, e.lng], {
            radius: 8,
            fillColor: '#ef4444',
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
            className: 'dot-emerg' // will trigger glowingPulse animation
          })
            .addTo(emergLayer)
            .bindPopup(`<strong>🚨 ${e.patientName} (${e.bloodType})</strong><br>${e.hospital} · ${e.ward}<br>${e.urgency} · ${e.units} unit(s) needed`);

          registerMarker('emergency', e.id, m);
          if (onSelectEmergency) {
            m.on('click', () => onSelectEmergency(e));
          }
        });
      }
    }
  }, [emergencies, donors, hospitals, bloodBanks, camps, filters, highlightedBankIds, onSelectEmergency, onSelectMarker]);

  // List -> Map sync: fly to and open the popup of whatever was selected in the sidebar
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedMarker) return;
    const marker = markerIndexRef.current.get(`${selectedMarker.type}-${selectedMarker.id}`);
    if (marker) {
      map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.6 });
      marker.openPopup();
    }
  }, [selectedMarker]);

  // Handle Directions
  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    routeLayer.clearLayers();

    if (activeDirections) {
      const { destLat, destLng, destName } = activeDirections;

      // Draw route line
      const pathCoordinates: [number, number][] = [
        userLoc,
        [destLat, destLng]
      ];

      const routeLine = L.polyline(pathCoordinates, {
        color: '#e74c3c',
        weight: 4,
        opacity: 0.85,
        dashArray: '8, 8'
      }).addTo(routeLayer);

      map.fitBounds(routeLine.getBounds(), { padding: [50, 50] });

      // Generate simulated route details
      const start = L.latLng(userLoc);
      const end = L.latLng([destLat, destLng]);
      const distanceMetres = start.distanceTo(end);
      const distanceKM = (distanceMetres / 1000).toFixed(1);
      const durationMin = Math.ceil(distanceMetres / 400); // approx 24km/h driving in traffic

      const getCompassDirection = (s: [number, number], e: [number, number]) => {
        const latDiff = e[0] - s[0];
        const lngDiff = e[1] - s[1];
        let dir = '';
        if (latDiff > 0.003) dir += 'North';
        else if (latDiff < -0.003) dir += 'South';
        if (lngDiff > 0.003) dir += dir ? 'east' : 'East';
        else if (lngDiff < -0.003) dir += dir ? 'west' : 'West';
        return dir || 'ahead';
      };

      const dirStr = getCompassDirection(userLoc, [destLat, destLng]);

      const steps = [
        `Start from your current location towards ${destName}.`,
        `Head ${dirStr} on the main road for ${(distanceMetres * 0.4 / 1000).toFixed(1)} km.`,
        `Turn slightly right past the landmark intersection and proceed.`,
        `Arrive at ${destName} on your left.`
      ];

      if (onRouteGenerated) {
        onRouteGenerated({
          distance: `${distanceKM} km`,
          duration: `${durationMin} mins`,
          steps
        });
      }
    }
    // Re-run whenever the destination or the viewer's real/fallback location changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDirections, onRouteGenerated, userLocation.lat, userLocation.lng]);

  return (
    <div 
      ref={mapContainerRef} 
      id="map-area" 
      className="map-area" 
      style={{ height: '520px', width: '100%', borderRadius: 'var(--r)' }}
    />
  );
};
