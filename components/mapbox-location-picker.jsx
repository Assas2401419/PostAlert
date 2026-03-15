'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Crosshair,
  LoaderCircle,
  MapPinned,
  Navigation,
  Search,
  X
} from 'lucide-react';

import {
  getNearestParishByCoordinates,
  hasMapboxToken,
  JAMAICA_CENTER,
  JAMAICA_MAX_BOUNDS,
  MAPBOX_STYLE,
  MAPBOX_TOKEN,
  reverseGeocodeLocation,
  searchMapboxPlaces
} from '../lib/mapbox-service.js';

function defaultLocation(value) {
  const latitude = Number(value?.latitude || 18.0);
  const longitude = Number(value?.longitude || -76.8);
  return {
    latitude,
    longitude,
    address: value?.address || `${getNearestParishByCoordinates(latitude, longitude)}, Jamaica`,
    parish: value?.parish || getNearestParishByCoordinates(latitude, longitude)
  };
}

export function MapboxLocationPicker({ onChange, value }) {
  const containerRef = useRef(null);
  const geolocateControlRef = useRef(null);
  const lookupRef = useRef(0);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const resizeHandlerRef = useRef(null);
  const searchTimerRef = useRef(null);
  const updateTimerRef = useRef(null);
  const [location, setLocation] = useState(defaultLocation(value));
  const [search, setSearch] = useState(value?.address || '');
  const [results, setResults] = useState([]);
  const [loadingResults, setLoadingResults] = useState(false);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState('');
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    const next = defaultLocation(value);
    setLocation(next);
    setSearch(next.address);
    markerRef.current?.setLngLat([next.longitude, next.latitude]);
    mapRef.current?.easeTo({
      center: [next.longitude, next.latitude],
      duration: 400
    });
  }, [value?.address, value?.latitude, value?.longitude, value?.parish]);

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

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_STYLE,
          center: [location.longitude, location.latitude],
          zoom: 13,
          maxBounds: JAMAICA_MAX_BOUNDS,
          dragRotate: false,
          touchPitch: false,
          pitchWithRotate: false
        });

        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');

        const geolocate = new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          showAccuracyCircle: true,
          showUserHeading: false,
          trackUserLocation: false,
          fitBoundsOptions: {
            maxZoom: 15
          }
        });
        geolocateControlRef.current = geolocate;
        map.addControl(geolocate, 'top-left');

        const markerElement = document.createElement('div');
        markerElement.className = 'location-picker-marker';

        const marker = new mapboxgl.Marker({
          draggable: true,
          element: markerElement
        })
          .setLngLat([location.longitude, location.latitude])
          .addTo(map);
        markerRef.current = marker;

        map.on('click', (event) => {
          syncLocation(
            {
              latitude: event.lngLat.lat,
              longitude: event.lngLat.lng
            },
            { flyTo: false, syncSearch: true }
          );
        });

        marker.on('drag', () => {
          const nextLngLat = marker.getLngLat();
          setLocation((current) => ({
            ...current,
            latitude: Number(nextLngLat.lat.toFixed(5)),
            longitude: Number(nextLngLat.lng.toFixed(5))
          }));
          setStatus('Updating address…');
          if (updateTimerRef.current) {
            window.clearTimeout(updateTimerRef.current);
          }
          updateTimerRef.current = window.setTimeout(() => {
            syncLocation(
              {
                latitude: nextLngLat.lat,
                longitude: nextLngLat.lng
              },
              { flyTo: false, syncSearch: true }
            );
          }, 250);
        });

        marker.on('dragend', () => {
          const nextLngLat = marker.getLngLat();
          syncLocation(
            {
              latitude: nextLngLat.lat,
              longitude: nextLngLat.lng
            },
            { flyTo: false, syncSearch: true }
          );
        });

        geolocate.on('trackuserlocationstart', () => {
          setLocating(true);
          setStatus('Locating device…');
        });

        geolocate.on('geolocate', (event) => {
          syncLocation(
            {
              latitude: event.coords.latitude,
              longitude: event.coords.longitude
            },
            { flyTo: true, syncSearch: true, zoom: 15 }
          );
        });

        geolocate.on('error', () => {
          setLocating(false);
          setStatus('Location permission denied or unavailable.');
        });

        resizeHandlerRef.current = () => map.resize();
        window.addEventListener('resize', resizeHandlerRef.current);
      } catch (error) {
        setMapError(error.message || 'Mapbox location picker failed to load.');
      }
    }

    initialise();

    return () => {
      cancelled = true;
      if (resizeHandlerRef.current) {
        window.removeEventListener('resize', resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
      if (updateTimerRef.current) {
        window.clearTimeout(updateTimerRef.current);
      }
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hasMapboxToken()) {
      return undefined;
    }

    if (searchTimerRef.current) {
      window.clearTimeout(searchTimerRef.current);
    }

    if (!search.trim() || search.trim() === location.address) {
      setResults([]);
      setLoadingResults(false);
      return undefined;
    }

    setLoadingResults(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const nextResults = await searchMapboxPlaces(search, {
          proximity: {
            lat: location.latitude,
            lng: location.longitude
          }
        });
        setResults(nextResults);
      } catch {
        setResults([]);
      } finally {
        setLoadingResults(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) {
        window.clearTimeout(searchTimerRef.current);
      }
    };
  }, [location.address, location.latitude, location.longitude, search]);

  async function syncLocation(nextCoords, { flyTo = false, syncSearch = false, zoom = 14 } = {}) {
    const latitude = Number(nextCoords.latitude.toFixed(5));
    const longitude = Number(nextCoords.longitude.toFixed(5));

    setLocation((current) => ({
      ...current,
      latitude,
      longitude
    }));

    if (markerRef.current) {
      markerRef.current.setLngLat([longitude, latitude]);
    }

    if (flyTo && mapRef.current) {
      mapRef.current.flyTo({
        center: [longitude, latitude],
        zoom,
        duration: 900
      });
    }

    const requestId = lookupRef.current + 1;
    lookupRef.current = requestId;
    setStatus('Updating address…');

    try {
      const nextLocation = await reverseGeocodeLocation(latitude, longitude);
      if (lookupRef.current !== requestId) {
        return;
      }

      setLocation(nextLocation);
      if (syncSearch) {
        setSearch(nextLocation.address);
        setResults([]);
      }
      onChange?.(nextLocation);
      setStatus('');
    } catch {
      const fallback = {
        latitude,
        longitude,
        address: `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`,
        parish: getNearestParishByCoordinates(latitude, longitude)
      };
      setLocation(fallback);
      if (syncSearch) {
        setSearch(fallback.address);
        setResults([]);
      }
      onChange?.(fallback);
      setStatus('Address lookup unavailable. Coordinates were saved.');
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    if (markerRef.current) {
      markerRef.current.setLngLat([location.longitude, location.latitude]);
    }
  }, [location.latitude, location.longitude]);

  if (!hasMapboxToken()) {
    return (
      <div className="mapbox-picker-fallback">
        <div className="mapbox-empty-state">
          <MapPinned aria-hidden="true" className="h-5 w-5" />
          <span>Add `NEXT_PUBLIC_MAPBOX_TOKEN` to enable address search and draggable pinning.</span>
        </div>
      </div>
    );
  }

  if (mapError) {
    return (
      <div className="mapbox-picker-fallback">
        <div className="mapbox-empty-state">
          <MapPinned aria-hidden="true" className="h-5 w-5" />
          <span>{mapError}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="location-picker-shell">
      <div className="location-picker-toolbar">
        <div className="location-picker-search">
          <Search aria-hidden="true" className="h-4 w-4 text-slate-400" />
          <input
            className="location-picker-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search for address or landmark..."
            value={search}
          />
          {loadingResults ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-amber-300" />
          ) : search ? (
            <button
              aria-label="Clear search"
              className="location-picker-clear"
              onClick={() => {
                setSearch('');
                setResults([]);
              }}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <button
          className="ghost-button"
          onClick={() => {
            setLocating(true);
            setStatus('Locating device…');
            geolocateControlRef.current?.trigger();
          }}
          type="button"
        >
          <Navigation aria-hidden="true" className="h-4 w-4" />
          Locate me
        </button>
      </div>

      {results.length ? (
        <div className="location-picker-results">
          {results.map((result) => (
            <button
              key={result.id}
              className="location-picker-result"
              onClick={() =>
                syncLocation(
                  {
                    latitude: result.latitude,
                    longitude: result.longitude
                  },
                  { flyTo: true, syncSearch: true, zoom: 15 }
                )
              }
              type="button"
            >
              <MapPinned aria-hidden="true" className="h-4 w-4 text-amber-300" />
              <div className="min-w-0 text-left">
                <div className="truncate text-sm font-semibold text-white">{result.label}</div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {result.parish}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : null}

      <div className="location-picker-map-shell">
        <div className="mapbox-map-frame" ref={containerRef} />
        <div className="location-picker-hint">
          <Crosshair aria-hidden="true" className="h-4 w-4" />
          Drag the pin or click the map to refine the incident location.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-muted">
          <div className="section-label mb-2">Detected address</div>
          <div className="text-sm leading-6 text-slate-200">{location.address}</div>
        </div>
        <div className="surface-muted">
          <div className="section-label mb-2">Parish</div>
          <div className="text-sm leading-6 text-slate-200">{location.parish}</div>
        </div>
        <div className="surface-muted">
          <div className="section-label mb-2">Coordinates</div>
          <div className="text-sm leading-6 text-slate-200">
            {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
          </div>
        </div>
      </div>

      {status ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
          {locating ? 'Locating device… ' : null}
          {status}
        </div>
      ) : null}
    </div>
  );
}
