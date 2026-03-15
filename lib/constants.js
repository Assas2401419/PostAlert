import {
  AlertTriangle,
  CarFront,
  CloudRain,
  Megaphone,
  ShieldAlert,
  Wrench
} from 'lucide-react';

export const PARISHES = [
  'Kingston',
  'St. Andrew',
  'St. Thomas',
  'Portland',
  'St. Mary',
  'St. Ann',
  'Trelawny',
  'St. James',
  'Hanover',
  'Westmoreland',
  'St. Elizabeth',
  'Manchester',
  'Clarendon',
  'St. Catherine'
];

export const PARISH_CENTERS = {
  Kingston: { lat: 17.9712, lng: -76.7928 },
  'St. Andrew': { lat: 18.0226, lng: -76.7936 },
  'St. Thomas': { lat: 17.9077, lng: -76.3576 },
  Portland: { lat: 18.176, lng: -76.45 },
  'St. Mary': { lat: 18.356, lng: -76.897 },
  'St. Ann': { lat: 18.405, lng: -77.103 },
  Trelawny: { lat: 18.352, lng: -77.647 },
  'St. James': { lat: 18.4712, lng: -77.9188 },
  Hanover: { lat: 18.409, lng: -78.133 },
  Westmoreland: { lat: 18.166, lng: -78.16 },
  'St. Elizabeth': { lat: 18.051, lng: -77.848 },
  Manchester: { lat: 18.042, lng: -77.507 },
  Clarendon: { lat: 17.964, lng: -77.245 },
  'St. Catherine': { lat: 17.997, lng: -76.955 }
};

export const CATEGORY_SUBCATEGORIES = {
  Crime: ['Robbery', 'Assault', 'Suspicious Activity', 'Burglary', 'Violence'],
  Accident: ['Vehicle Collision', 'Pedestrian Injury', 'Road Hazard', 'Fire', 'Marine Incident'],
  'Natural Disaster': ['Flooding', 'Landslide', 'Hurricane Damage', 'Earthquake Impact', 'Storm Surge'],
  Infrastructure: ['Power Outage', 'Water Supply', 'Road Damage', 'Collapsed Drain', 'Bridge Issue'],
  'Community Alert': ['Missing Person', 'School Lockdown', 'Public Health', 'Crowd Surge', 'Evacuation']
};

export const CATEGORY_META = {
  Crime: { icon: ShieldAlert, accent: 'text-rose-500', surface: 'bg-rose-500/10' },
  Accident: { icon: CarFront, accent: 'text-amber-500', surface: 'bg-amber-500/10' },
  'Natural Disaster': { icon: CloudRain, accent: 'text-cyan-500', surface: 'bg-cyan-500/10' },
  Infrastructure: { icon: Wrench, accent: 'text-lime-500', surface: 'bg-lime-500/10' },
  'Community Alert': { icon: Megaphone, accent: 'text-blue-500', surface: 'bg-blue-500/10' }
};

export const FALLBACK_CATEGORY_ICON = AlertTriangle;

export const SEVERITY_META = {
  low: { label: 'Low', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  medium: { label: 'Medium', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  high: { label: 'High', chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  critical: { label: 'Critical', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30' }
};

export const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

export const MAP_BOUNDS = {
  latMin: 17.65,
  latMax: 18.55,
  lngMin: -78.45,
  lngMax: -76.1
};

export const DEFAULT_NOTIFICATION_PREFS = {
  enabled: false,
  categories: Object.keys(CATEGORY_SUBCATEGORIES),
  minSeverity: 'high',
  radiusKm: 5,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:00'
};

export const PROHIBITED_KEYWORDS = ['fake bomb', 'target civilians', 'hate speech'];
export const SENSITIVE_KEYWORDS = ['gun', 'knife', 'blood', 'child', 'shooting', 'domestic abuse'];
