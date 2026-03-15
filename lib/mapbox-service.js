import { MAP_BOUNDS, PARISHES, PARISH_CENTERS } from './constants.js';
import { haversineKm, withinJamaica } from './utils.js';

export const MAPBOX_STYLE = 'mapbox://styles/mapbox/streets-v12';
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
export const JAMAICA_CENTER = [-76.8, 18.0];
export const JAMAICA_MAX_BOUNDS = [
  [MAP_BOUNDS.lngMin, MAP_BOUNDS.latMin],
  [MAP_BOUNDS.lngMax, MAP_BOUNDS.latMax]
];

const forwardCache = new Map();
const reverseCache = new Map();

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replaceAll('.', '')
    .trim();
}

function createCacheKey(prefix, payload) {
  return `${prefix}:${JSON.stringify(payload)}`;
}

export function hasMapboxToken() {
  return Boolean(MAPBOX_TOKEN);
}

export function getSeverityColor(severity) {
  const tones = {
    critical: '#DC2626',
    high: '#EF4444',
    medium: '#F59E0B',
    low: '#10B981'
  };
  return tones[severity] || tones.medium;
}

export function getNearestParishByCoordinates(latitude, longitude) {
  const ranked = Object.entries(PARISH_CENTERS)
    .map(([name, center]) => ({
      name,
      distance: haversineKm(latitude, longitude, center.lat, center.lng)
    }))
    .sort((left, right) => left.distance - right.distance);

  return ranked[0]?.name || 'Kingston';
}

function extractParishFromFeature(feature) {
  const searchSpace = normalizeText(JSON.stringify(feature));
  const matched = PARISHES.find((parish) => {
    const target = normalizeText(parish);
    return searchSpace.includes(target);
  });

  return matched || '';
}

function featureLabel(feature) {
  return (
    feature?.properties?.full_address ||
    feature?.place_name ||
    feature?.properties?.place_formatted ||
    feature?.properties?.name ||
    feature?.text ||
    feature?.name ||
    'Unknown location'
  );
}

function featureCoordinates(feature) {
  const coordinates = feature?.geometry?.coordinates || feature?.center || [];
  return {
    lng: Number(coordinates[0] || 0),
    lat: Number(coordinates[1] || 0)
  };
}

function formatPlaceResult(feature) {
  const coordinates = featureCoordinates(feature);
  return {
    id: feature?.id || feature?.properties?.mapbox_id || `${coordinates.lng}:${coordinates.lat}`,
    label: featureLabel(feature),
    parish:
      extractParishFromFeature(feature) || getNearestParishByCoordinates(coordinates.lat, coordinates.lng),
    latitude: coordinates.lat,
    longitude: coordinates.lng,
    raw: feature
  };
}

export async function searchMapboxPlaces(query, { proximity, limit = 5 } = {}) {
  if (!hasMapboxToken() || !query || query.trim().length < 2) {
    return [];
  }

  const cacheKey = createCacheKey('forward', { query, proximity, limit });
  if (forwardCache.has(cacheKey)) {
    return forwardCache.get(cacheKey);
  }

  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('access_token', MAPBOX_TOKEN);
  url.searchParams.set('country', 'jm');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('types', 'address,street,place,locality,neighborhood,district');
  if (proximity?.lat && proximity?.lng) {
    url.searchParams.set('proximity', `${proximity.lng},${proximity.lat}`);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error('Map search is currently unavailable.');
  }

  const data = await response.json();
  const results = Array.isArray(data.features)
    ? data.features.map(formatPlaceResult).filter((feature) => withinJamaica(feature.latitude, feature.longitude))
    : [];

  forwardCache.set(cacheKey, results);
  return results;
}

export async function reverseGeocodeLocation(latitude, longitude) {
  if (!hasMapboxToken()) {
    return {
      address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
      parish: getNearestParishByCoordinates(latitude, longitude),
      latitude,
      longitude
    };
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  const roundedLat = Number(lat.toFixed(5));
  const roundedLng = Number(lng.toFixed(5));
  const cacheKey = createCacheKey('reverse', { roundedLat, roundedLng });

  if (reverseCache.has(cacheKey)) {
    return reverseCache.get(cacheKey);
  }

  const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
  url.searchParams.set('latitude', String(roundedLat));
  url.searchParams.set('longitude', String(roundedLng));
  url.searchParams.set('access_token', MAPBOX_TOKEN);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const fallback = {
      address: `${roundedLat.toFixed(5)}, ${roundedLng.toFixed(5)}`,
      parish: getNearestParishByCoordinates(roundedLat, roundedLng),
      latitude: roundedLat,
      longitude: roundedLng
    };
    reverseCache.set(cacheKey, fallback);
    return fallback;
  }

  const data = await response.json();
  const feature = Array.isArray(data.features) ? data.features[0] : null;
  const result = {
    address: featureLabel(feature),
    parish: extractParishFromFeature(feature) || getNearestParishByCoordinates(roundedLat, roundedLng),
    latitude: roundedLat,
    longitude: roundedLng
  };

  reverseCache.set(cacheKey, result);
  return result;
}

export function createIncidentFeatureCollection(incidents, highlightedIncidentId = '') {
  return {
    type: 'FeatureCollection',
    features: incidents
      .filter((incident) => Number.isFinite(Number(incident.latitude)) && Number.isFinite(Number(incident.longitude)))
      .map((incident) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(incident.longitude), Number(incident.latitude)]
        },
        properties: {
          id: incident.id,
          title: incident.title,
          address: incident.address || `${incident.parish}, Jamaica`,
          severity: incident.severity,
          category: incident.category,
          subcategory: incident.subcategory || incident.category,
          parish: incident.parish,
          createdAt: incident.createdAt,
          confirmationCount: incident.confirmationCount || 0,
          highlighted: incident.id === highlightedIncidentId ? 'true' : 'false'
        }
      }))
  };
}
