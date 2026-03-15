import { INCIDENT_PHOTO_UPLOAD, MAP_BOUNDS, SEVERITY_ORDER } from './constants.js';

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

export function estimateDataUrlBytes(dataUrl) {
  const payload = String(dataUrl || '').split(',')[1] || '';
  if (!payload) {
    return 0;
  }

  const normalized = payload.replace(/\s/g, '');
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.ceil((normalized.length * 3) / 4) - padding);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function replaceFileExtension(name, extension) {
  const basename = String(name || 'photo').replace(/\.[^.]+$/, '');
  return `${basename}.${extension}`;
}

function fitImageWithin(width, height, maxDimension) {
  if (!width || !height) {
    return {
      width: maxDimension,
      height: maxDimension
    };
  }

  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('This image could not be prepared for upload.'));
    };
    image.src = objectUrl;
  });
}

export async function normalizeIncidentPhoto(file) {
  if (!INCIDENT_PHOTO_UPLOAD.allowedTypes.includes(file?.type)) {
    throw new Error('Only JPEG or PNG files are allowed.');
  }

  if (Number(file.size || 0) <= INCIDENT_PHOTO_UPLOAD.maxBytes) {
    return {
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await readFileAsDataUrl(file)
    };
  }

  if (typeof window === 'undefined') {
    throw new Error('Large photos can only be prepared in the browser.');
  }

  const image = await loadImageFromFile(file);
  const qualitySteps = [0.84, 0.72, 0.6];
  const dimensionSteps = [INCIDENT_PHOTO_UPLOAD.maxDimension, 1280, 960, 720];

  for (const maxDimension of dimensionSteps) {
    const { width, height } = fitImageWithin(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      maxDimension
    );
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      continue;
    }

    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualitySteps) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (!blob || blob.size > INCIDENT_PHOTO_UPLOAD.maxBytes) {
        continue;
      }

      const name = replaceFileExtension(file.name, 'jpg');
      const optimizedFile = new File([blob], name, {
        type: 'image/jpeg'
      });

      return {
        name,
        type: optimizedFile.type,
        size: optimizedFile.size,
        dataUrl: await readFileAsDataUrl(optimizedFile)
      };
    }
  }

  throw new Error('This photo is too large to optimize for upload. Use a smaller image.');
}
