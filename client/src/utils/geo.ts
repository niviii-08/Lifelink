import { useCallback, useState } from 'react';

export interface Coordinates {
  lat: number;
  lng: number;
}

// Fallback used when the browser denies/lacks geolocation, or when an entity
// (donor/hospital/blood bank) has no stored coordinates yet.
export const COIMBATORE_CENTER: Coordinates = { lat: 11.0168, lng: 76.9558 };

const EARTH_RADIUS_KM = 6371;

/**
 * Real Haversine great-circle distance between two lat/lng points, in km.
 * Replaces the hardcoded per-id "distance guess" maps that used to live
 * in individual pages.
 */
export const getDistanceKm = (a: Coordinates, b: Coordinates): number => {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_KM * c;
};

export const formatDistance = (km: number): string => {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
};

/** Rough driving-time estimate for display purposes only (no routing API key configured). */
export const estimateDrivingMinutes = (km: number): number => Math.max(1, Math.ceil((km / 24) * 60));

type GeoStatus = 'idle' | 'locating' | 'success' | 'denied' | 'unsupported' | 'error';

interface UseGeolocationResult {
  coords: Coordinates | null;
  status: GeoStatus;
  error: string | null;
  /** Coordinates to actually use for distance math: real location if available, else Coimbatore city center. */
  effectiveCoords: Coordinates;
  isUsingFallback: boolean;
  requestLocation: () => void;
}

/**
 * Wraps the browser Geolocation API with sane fallbacks so every page that
 * needs "distance from me" can share one implementation instead of each
 * inventing its own hardcoded distance table.
 */
export const useGeolocation = (): UseGeolocationResult => {
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      setError('Geolocation is not supported by this browser.');
      return;
    }

    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
        setStatus('success');
        setError(null);
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
        setError(err.message || 'Unable to determine your location.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  return {
    coords,
    status,
    error,
    effectiveCoords: coords ?? COIMBATORE_CENTER,
    isUsingFallback: coords === null,
    requestLocation,
  };
};
