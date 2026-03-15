import { MAP_BOUNDS, SEVERITY_ORDER } from './constants.js';

export function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function withinJamaica(latitude, longitude) {
  return (
    latitude >= MAP_BOUNDS.latMin &&
    latitude <= MAP_BOUNDS.latMax &&
    longitude >= MAP_BOUNDS.lngMin &&
    longitude <= MAP_BOUNDS.lngMax
  );
}

export function projectPoint(latitude, longitude) {
  const left = ((longitude - MAP_BOUNDS.lngMin) / (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin)) * 100;
  const top = ((MAP_BOUNDS.latMax - latitude) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin)) * 100;
  return {
    left: clampNumber(left, 4, 96),
    top: clampNumber(top, 8, 92)
  };
}

export function formatAgo(dateString) {
  const diff = Date.now() - new Date(dateString).getTime();
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

export function formatDateTime(dateString) {
  return new Intl.DateTimeFormat('en-JM', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(dateString));
}

export function severityIndex(severity) {
  return SEVERITY_ORDER.indexOf(severity);
}

export function createStartTime(timeRange) {
  const now = Date.now();
  const offsets = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };

  return new Date(now - offsets[timeRange]).toISOString();
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
