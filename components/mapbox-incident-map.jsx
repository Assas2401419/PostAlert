'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPinned } from 'lucide-react';

import {
  createIncidentFeatureCollection,
  getSeverityColor,
  hasMapboxToken,
  JAMAICA_CENTER,
  JAMAICA_MAX_BOUNDS,
  MAPBOX_STYLE,
  MAPBOX_TOKEN
} from '../lib/mapbox-service.js';
import { formatAgo } from '../lib/utils.js';

const INCIDENT_SOURCE_ID = 'incident-feed';
const USER_SOURCE_ID = 'user-location';

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function createEmptyCollection() {
  return {
    type: 'FeatureCollection',
    features: []
  };
}

function createUserCollection(userLocation) {
  if (!userLocation?.lat || !userLocation?.lng) {
    return createEmptyCollection();
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [Number(userLocation.lng), Number(userLocation.lat)]
        }
      }
    ]
  };
}

export function MapboxIncidentMap({
  className = '',
  highlightedIncidentId = '',
  incidents = [],
  initialZoom = 9,
  onIncidentSelect,
  singleIncident = false,
  userLocation
}) {
  const containerRef = useRef(null);
  const incidentsRef = useRef(incidents);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const resizeHandlerRef = useRef(null);
  const [mapError, setMapError] = useState('');

  incidentsRef.current = incidents;

  useEffect(() => {
    if (!hasMapboxToken() || mapRef.current || !containerRef.current) {
      return undefined;
    }

    let cancelled = false;

    async function initialise() {
      try {
        const mapboxgl = (await import('mapbox-gl')).default;
        if (cancelled || !containerRef.current) {
          return;
        }

        mapboxgl.accessToken = MAPBOX_TOKEN;

        const leadIncident = singleIncident ? incidentsRef.current[0] : null;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE,
          center: leadIncident
            ? [Number(leadIncident.longitude), Number(leadIncident.latitude)]
            : JAMAICA_CENTER,
          zoom: leadIncident ? 13.5 : initialZoom,
          maxBounds: JAMAICA_MAX_BOUNDS,
          dragRotate: false,
          touchPitch: false,
          pitchWithRotate: false
        });

        mapRef.current = map;
        popupRef.current = new mapboxgl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 16
        });

        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
        map.addControl(
          new mapboxgl.GeolocateControl({
            positionOptions: { enableHighAccuracy: true },
            showUserHeading: false,
            showAccuracyCircle: true,
            trackUserLocation: false
          }),
          'top-left'
        );
        map.addControl(new mapboxgl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

        map.on('load', () => {
          map.addSource(INCIDENT_SOURCE_ID, {
            type: 'geojson',
            data: createIncidentFeatureCollection(incidentsRef.current, highlightedIncidentId),
            cluster: !singleIncident,
            clusterMaxZoom: 12,
            clusterRadius: 48
          });

          map.addLayer({
            id: 'incident-clusters',
            type: 'circle',
            source: INCIDENT_SOURCE_ID,
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': '#f59e0b',
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18,
                10,
                22,
                25,
                28
              ],
              'circle-stroke-color': '#fffaf0',
              'circle-stroke-width': 2,
              'circle-opacity': 0.92
            }
          });

          map.addLayer({
            id: 'incident-cluster-count',
            type: 'symbol',
            source: INCIDENT_SOURCE_ID,
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 12,
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold']
            },
            paint: {
              'text-color': '#111826'
            }
          });

          map.addLayer({
            id: 'incident-points',
            type: 'circle',
            source: INCIDENT_SOURCE_ID,
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': [
                'match',
                ['get', 'severity'],
                'critical',
                getSeverityColor('critical'),
                'high',
                getSeverityColor('high'),
                'medium',
                getSeverityColor('medium'),
                getSeverityColor('low')
              ],
              'circle-radius': [
                'case',
                ['==', ['get', 'highlighted'], 'true'],
                12,
                9
              ],
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': [
                'case',
                ['==', ['get', 'highlighted'], 'true'],
                3,
                2
              ],
              'circle-opacity': 0.96
            }
          });

          map.addSource(USER_SOURCE_ID, {
            type: 'geojson',
            data: createUserCollection(userLocation)
          });

          map.addLayer({
            id: 'user-location-halo',
            type: 'circle',
            source: USER_SOURCE_ID,
            paint: {
              'circle-color': 'rgba(59, 130, 246, 0.18)',
              'circle-radius': 14
            }
          });

          map.addLayer({
            id: 'user-location-point',
            type: 'circle',
            source: USER_SOURCE_ID,
            paint: {
              'circle-color': '#38bdf8',
              'circle-radius': 6,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 2
            }
          });

          map.on('click', 'incident-clusters', (event) => {
            const feature = event.features?.[0];
            const clusterId = feature?.properties?.cluster_id;
            const source = map.getSource(INCIDENT_SOURCE_ID);
            if (!feature || clusterId == null || !source?.getClusterExpansionZoom) {
              return;
            }

            source.getClusterExpansionZoom(clusterId, (error, zoom) => {
              if (error) {
                return;
              }

              map.easeTo({
                center: feature.geometry.coordinates,
                zoom
              });
            });
          });

          map.on('mouseenter', 'incident-points', (event) => {
            map.getCanvas().style.cursor = 'pointer';
            const feature = event.features?.[0];
            if (!feature || !popupRef.current) {
              return;
            }

            popupRef.current
              .setLngLat(feature.geometry.coordinates)
              .setHTML(
                `<div class="mapbox-popup-card">
                  <div class="mapbox-popup-title">${escapeHtml(feature.properties.title)}</div>
                  <div class="mapbox-popup-meta">${escapeHtml(feature.properties.address)}</div>
                  <div class="mapbox-popup-meta">${escapeHtml(formatAgo(feature.properties.createdAt))}</div>
                </div>`
              )
              .addTo(map);
          });

          map.on('mouseleave', 'incident-points', () => {
            map.getCanvas().style.cursor = '';
            popupRef.current?.remove();
          });

          map.on('click', 'incident-points', (event) => {
            const feature = event.features?.[0];
            if (!feature) {
              return;
            }

            const incident = incidentsRef.current.find((entry) => entry.id === feature.properties.id);
            if (incident && onIncidentSelect) {
              onIncidentSelect(incident);
            }
          });

          if (leadIncident) {
            map.easeTo({
              center: [Number(leadIncident.longitude), Number(leadIncident.latitude)],
              zoom: 13.5,
              duration: 0
            });
          }
        });

        resizeHandlerRef.current = () => {
          map.resize();
        };
        window.addEventListener('resize', resizeHandlerRef.current);
      } catch (error) {
        setMapError(error.message || 'Mapbox failed to load.');
      }
    }

    initialise();

    return () => {
      cancelled = true;
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      popupRef.current?.remove();
      popupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [highlightedIncidentId, initialZoom, onIncidentSelect, singleIncident, userLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) {
      return;
    }

    const incidentSource = map.getSource(INCIDENT_SOURCE_ID);
    if (incidentSource?.setData) {
      incidentSource.setData(createIncidentFeatureCollection(incidents, highlightedIncidentId));
    }

    const userSource = map.getSource(USER_SOURCE_ID);
    if (userSource?.setData) {
      userSource.setData(createUserCollection(userLocation));
    }

    if (singleIncident && incidents[0]) {
      map.easeTo({
        center: [Number(incidents[0].longitude), Number(incidents[0].latitude)],
        zoom: 13.5,
        duration: 600
      });
    }
  }, [highlightedIncidentId, incidents, singleIncident, userLocation]);

  if (!hasMapboxToken()) {
    return (
      <div className={`mapbox-fallback ${className}`}>
        <div className="mapbox-empty-state">
          <MapPinned aria-hidden="true" className="h-5 w-5" />
          <span>Add `NEXT_PUBLIC_MAPBOX_TOKEN` to enable the live map.</span>
        </div>
      </div>
    );
  }

  if (mapError) {
    return (
      <div className={`mapbox-fallback ${className}`}>
        <div className="mapbox-empty-state">
          <MapPinned aria-hidden="true" className="h-5 w-5" />
          <span>{mapError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`mapbox-shell ${className}`}>
      <div className="mapbox-map-frame" ref={containerRef} />
    </div>
  );
}
