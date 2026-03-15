'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';
import { useSession } from 'next-auth/react';

import { DEFAULT_NOTIFICATION_PREFS } from './constants.js';
import { createSupabaseBrowserClient } from './supabase/client.js';
import { haversineKm, severityIndex } from './utils.js';

const NotificationContext = createContext(null);

const BROADCAST_CHANNEL_NAME = 'postalert-platform';
const EXIT_ANIMATION_DURATION = 300;
const MAX_VISIBLE_NOTIFICATIONS = 4;
const NOTIFICATION_DISPLAY_DURATION = 8000;
const NOTIFICATION_DEDUPE_WINDOW = 15000;

function mergePrefs(prefs = {}) {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...(prefs || {})
  };
}

function normalizeIncident(incident = {}, fallbackBody = '') {
  return {
    id: incident.id,
    category: incident.category || 'Community Alert',
    subcategory: incident.subcategory || incident.category || 'Incident',
    title:
      incident.title ||
      `${incident.subcategory || incident.category || 'Incident'} in ${incident.parish || 'Jamaica'}`,
    description: incident.description || fallbackBody || '',
    severity: incident.severity || 'medium',
    parish: incident.parish || '',
    latitude: Number(incident.latitude || 0),
    longitude: Number(incident.longitude || 0),
    address: incident.address || `${incident.parish || 'Jamaica'}`,
    reporterId: incident.reporterId || incident.reporter_id || '',
    reporterName:
      incident.reporter?.name ||
      incident.reporterName ||
      incident.reporter_name ||
      'Community Member',
    confirmationCount:
      incident.confirmationCount || incident.confirmation_count || 0,
    createdAt: incident.createdAt || incident.created_at || new Date().toISOString(),
    notificationTitle: incident.notificationTitle || '',
    notificationBody: incident.notificationBody || fallbackBody || ''
  };
}

function shouldDisplayForUser(incident, user) {
  if (!incident?.id || !user?.id) {
    return false;
  }

  const isOperationalUser = user.role === 'admin' || user.role === 'authority';
  const prefs = mergePrefs(user.notificationPrefs);
  if (incident.reporterId === user.id) {
    return false;
  }
  if (isOperationalUser) {
    return true;
  }
  if (!prefs.enabled) {
    return false;
  }
  if (!prefs.categories.includes(incident.category)) {
    return false;
  }
  if (severityIndex(incident.severity) < severityIndex(prefs.minSeverity)) {
    return false;
  }

  const sameParish = Boolean(user.parish) && incident.parish === user.parish;
  const hasLocation =
    Number.isFinite(Number(user.lastKnownLocation?.lat)) &&
    Number.isFinite(Number(user.lastKnownLocation?.lng)) &&
    Number.isFinite(Number(incident.latitude)) &&
    Number.isFinite(Number(incident.longitude));
  const withinRadius = hasLocation
    ? haversineKm(
        Number(user.lastKnownLocation.lat),
        Number(user.lastKnownLocation.lng),
        incident.latitude,
        incident.longitude
      ) <= Number(prefs.radiusKm || DEFAULT_NOTIFICATION_PREFS.radiusKm)
    : false;

  return sameParish || withinRadius;
}

function createQueueItem(incident, options = {}) {
  return {
    id: options.id || `notif_${incident.id}_${Date.now()}`,
    incident,
    durationMs: options.durationMs || NOTIFICATION_DISPLAY_DURATION,
    remainingMs: options.durationMs || NOTIFICATION_DISPLAY_DURATION,
    startedAt: Date.now(),
    isPaused: false,
    isExiting: false,
    createdAt: new Date().toISOString()
  };
}

export function NotificationProvider({ children }) {
  const { data: session } = useSession();
  const [notifications, setNotifications] = useState([]);
  const exitTimersRef = useRef(new Map());
  const seenIncidentsRef = useRef(new Map());
  const knownNotificationIdsRef = useRef(new Set());
  const profileNotificationsReadyRef = useRef(false);

  const addNotification = useCallback((incidentInput, options = {}) => {
    const incident = normalizeIncident(incidentInput, options.fallbackBody);
    if (!incident.id) {
      return null;
    }

    const seenAt = seenIncidentsRef.current.get(incident.id);
    if (seenAt && Date.now() - seenAt < NOTIFICATION_DEDUPE_WINDOW) {
      return null;
    }

    seenIncidentsRef.current.set(incident.id, Date.now());
    window.setTimeout(() => {
      seenIncidentsRef.current.delete(incident.id);
    }, NOTIFICATION_DEDUPE_WINDOW);

    const nextNotification = createQueueItem(incident, options);
    setNotifications((current) => {
      const withoutSameIncident = current.filter((entry) => entry.incident.id !== incident.id);
      return [nextNotification, ...withoutSameIncident].slice(0, MAX_VISIBLE_NOTIFICATIONS);
    });

    return nextNotification.id;
  }, []);

  const removeNotification = useCallback((notificationId) => {
    setNotifications((current) =>
      current.map((entry) =>
        entry.id === notificationId ? { ...entry, isExiting: true, isPaused: false } : entry
      )
    );
  }, []);

  const pauseNotification = useCallback((notificationId) => {
    setNotifications((current) =>
      current.map((entry) => {
        if (entry.id !== notificationId || entry.isPaused || entry.isExiting) {
          return entry;
        }

        const elapsed = Date.now() - entry.startedAt;
        return {
          ...entry,
          isPaused: true,
          remainingMs: Math.max(0, entry.remainingMs - elapsed)
        };
      })
    );
  }, []);

  const resumeNotification = useCallback((notificationId) => {
    setNotifications((current) =>
      current.map((entry) => {
        if (entry.id !== notificationId || entry.isExiting || !entry.isPaused) {
          return entry;
        }

        return {
          ...entry,
          isPaused: false,
          startedAt: Date.now()
        };
      })
    );
  }, []);

  const clearAll = useCallback(() => {
    setNotifications((current) =>
      current.map((entry) => ({ ...entry, isExiting: true, isPaused: false }))
    );
  }, []);

  const triggerTestNotification = useCallback(() => {
    addNotification({
      id: `test-${Date.now()}`,
      category: 'Community Alert',
      subcategory: 'Test alert',
      title: 'Test alert in progress',
      description:
        'This is a sample in-app notification for validating animation, queueing, and actions.',
      severity: 'high',
      parish: session?.user?.parish || 'Kingston',
      address: `Test route, ${session?.user?.parish || 'Kingston'}`,
      reporterName: 'System test',
      createdAt: new Date().toISOString()
    });
  }, [addNotification, session?.user?.parish]);

  const ingestServerNotification = useCallback(
    async (row, source = 'server') => {
      const notificationId = String(row?.id || row?.incident_id || row?.incidentId || '');
      const incidentId = row?.incident_id || row?.incidentId || '';
      if (!notificationId || !incidentId || knownNotificationIdsRef.current.has(notificationId)) {
        return;
      }

      knownNotificationIdsRef.current.add(notificationId);

      try {
        const response = await fetch(`/api/incidents/${incidentId}`);
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        const incident = normalizeIncident(data.incident, row.body || '');
        addNotification(
          {
            ...incident,
            notificationTitle: row.title || '',
            notificationBody: row.body || ''
          },
          {
            id: `notif_${notificationId}`,
            source
          }
        );
      } catch {
        // Ignore transient notification fetch failures.
      }
    },
    [addNotification]
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNotifications((current) =>
        current.map((entry) => {
          if (entry.isPaused || entry.isExiting) {
            return entry;
          }

          if (now - entry.startedAt >= entry.remainingMs) {
            return { ...entry, isExiting: true };
          }

          return entry;
        })
      );
    }, 100);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    notifications
      .filter((entry) => entry.isExiting)
      .forEach((entry) => {
        if (exitTimersRef.current.has(entry.id)) {
          return;
        }

        const timer = window.setTimeout(() => {
          setNotifications((current) => current.filter((candidate) => candidate.id !== entry.id));
          exitTimersRef.current.delete(entry.id);
        }, EXIT_ANIMATION_DURATION);
        exitTimersRef.current.set(entry.id, timer);
      });
  }, [notifications]);

  useEffect(() => {
    return () => {
      exitTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      exitTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.BroadcastChannel || !session?.user) {
      return undefined;
    }

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channel.onmessage = (event) => {
      if (event.data?.type !== 'incident-notification' || !event.data?.incident) {
        return;
      }

      const incident = normalizeIncident(event.data.incident);
      if (!shouldDisplayForUser(incident, session.user)) {
        return;
      }

      addNotification(incident, {
        source: 'local-broadcast'
      });
    };

    return () => channel.close();
  }, [addNotification, session?.user]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !session?.user?.id) {
      return undefined;
    }

    const channel = supabase
      .channel(`incident-notifications-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${session.user.id}`
        },
        async (payload) => {
          const row = payload.new;
          if (!row?.incident_id) {
            return;
          }
          ingestServerNotification(row, 'supabase');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ingestServerNotification, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) {
      profileNotificationsReadyRef.current = false;
      knownNotificationIdsRef.current.clear();
      return undefined;
    }

    let cancelled = false;

    const syncProfileNotifications = async () => {
      try {
        const response = await fetch('/api/profile', {
          cache: 'no-store'
        });
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        const rows = Array.isArray(data.notifications) ? data.notifications : [];
        if (!profileNotificationsReadyRef.current) {
          rows.forEach((row) => {
            if (row?.id) {
              knownNotificationIdsRef.current.add(String(row.id));
            }
          });
          profileNotificationsReadyRef.current = true;
          return;
        }

        const freshRows = rows.filter((row) => row?.id && !knownNotificationIdsRef.current.has(String(row.id)));
        for (const row of freshRows.reverse()) {
          if (cancelled) {
            return;
          }
          await ingestServerNotification(row, 'profile-poll');
        }
      } catch {
        // Ignore local polling failures and retry on the next interval.
      }
    };

    syncProfileNotifications();
    const interval = window.setInterval(syncProfileNotifications, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [ingestServerNotification, session?.user?.id]);

  const value = {
    notifications,
    addNotification,
    removeNotification,
    pauseNotification,
    resumeNotification,
    clearAll,
    triggerTestNotification
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
