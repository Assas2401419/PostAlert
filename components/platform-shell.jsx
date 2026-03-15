'use client';

import {
  startTransition,
  useEffect,
  useRef,
  useState
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  LayoutGrid,
  LayoutList,
  Menu,
  MapPinned,
  RadioTower,
  Search,
  ShieldCheck,
  Siren,
  TriangleAlert,
  Upload,
  UserRound,
  X
} from 'lucide-react';

import {
  CATEGORY_META,
  CATEGORY_SUBCATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  FALLBACK_CATEGORY_ICON,
  INCIDENT_PHOTO_UPLOAD,
  MAP_BOUNDS,
  PARISH_CENTERS,
  PARISHES,
  SEVERITY_META
} from '../lib/constants.js';
import {
  createStartTime,
  estimateDataUrlBytes,
  formatAgo,
  formatDateTime,
  haversineKm,
  normalizeIncidentPhoto,
  projectPoint,
  withinJamaica
} from '../lib/utils.js';
import { createSupabaseBrowserClient } from '../lib/supabase/client.js';
import { MapboxIncidentMap } from './mapbox-incident-map.jsx';
import { MapboxLocationPicker } from './mapbox-location-picker.jsx';

const INCIDENT_CACHE_KEY = 'postalert_cached_incidents';
const MAPBOX_ENABLED = Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN);
const PLATFORM_BROADCAST_CHANNEL_NAME = 'postalert-platform';
const REPORT_QUEUE_KEY = 'postalert_report_queue';
const AUTHORITY_ACTION_OPTIONS = ['verify', 'respond', 'resolve', 'dismiss'];

export function PlatformShell({ page, incidentId = '' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status, update } = useSession();
  const channelRef = useRef(null);
  const lastAuthorityAlertIdRef = useRef('');
  const realtimeRef = useRef(null);
  const listEndRef = useRef(null);
  const [incidents, setIncidents] = useState(readFromStorage(INCIDENT_CACHE_KEY, []));
  const [filters, setFilters] = useState({
    categories: [],
    severities: [],
    timeRange: '24h',
    parish: ''
  });
  const [feedView, setFeedView] = useState('map');
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [detailIncident, setDetailIncident] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [authorityFilters, setAuthorityFilters] = useState({
    parish: '',
    status: ''
  });
  const [pendingAuthorities, setPendingAuthorities] = useState([]);
  const [profileBundle, setProfileBundle] = useState(null);
  const [activityBundle, setActivityBundle] = useState(null);
  const [trendsBundle, setTrendsBundle] = useState({
    counts: {},
    heatmap: [],
    top: [],
    total: 0,
    summary: {
      '24h': 0,
      '7d': 0,
      '30d': 0
    },
    period: '24h',
    parish: '',
    dateFrom: '',
    dateTo: ''
  });
  const [queue, setQueue] = useState(readFromStorage(REPORT_QUEUE_KEY, []));
  const [online, setOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);
  const [flash, setFlash] = useState(null);
  const [authErrors, setAuthErrors] = useState({});
  const [authConfirmation, setAuthConfirmation] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resetPreview, setResetPreview] = useState(null);
  const [authorityAlert, setAuthorityAlert] = useState(null);

  const selectedIncidentId = page === 'incident' ? incidentId : searchParams.get('incident');
  const sessionUser = session?.user || null;
  const currentUser = profileBundle?.user || sessionUser;
  const canPost = Boolean(currentUser?.canPost);
  const initialAuthMode = normalizeAuthMode(searchParams.get('mode'));
  const postAuthPath = normalizeCallbackPath(searchParams.get('callbackUrl'));
  const showAuthorityRoute =
    currentUser?.role === 'authority' ||
    currentUser?.role === 'admin' ||
    currentUser?.role === 'authority_pending';

  useEffect(() => {
    if (typeof window !== 'undefined' && 'caches' in window) {
      window.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith('postalert-next-shell'))
              .map((key) => window.caches.delete(key))
          )
        )
        .catch(() => {});
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => registration.update())
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.BroadcastChannel) {
      return;
    }
    const channel = new BroadcastChannel(PLATFORM_BROADCAST_CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (event) => {
      if (event.data?.type === 'refresh-incidents') {
        loadIncidents(1, false);
      }
      if (event.data?.type === 'refresh-profile' && page === 'profile') {
        loadProfileData();
      }
      if (event.data?.type === 'refresh-authority' && page === 'authority') {
        loadAuthorityData();
      }
    };
    return () => channel.close();
  }, [page]);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!flash) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setFlash(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  useEffect(() => {
    if (page === 'feed') {
      loadIncidents(1, false);
      const interval = window.setInterval(() => loadIncidents(1, false, true), 15000);
      return () => window.clearInterval(interval);
    }
    return undefined;
  }, [page, filters.timeRange, filters.parish, filters.categories.join(','), filters.severities.join(',')]);

  useEffect(() => {
    if (!selectedIncidentId) {
      setDetailIncident(null);
      return;
    }
    if (page !== 'feed' && page !== 'incident') {
      setDetailIncident(null);
      return;
    }

    setLoadingDetail(true);
    apiRequest(`/api/incidents/${selectedIncidentId}`)
      .then(({ incident }) => setDetailIncident(incident))
      .catch((error) => setFlash({ tone: 'error', message: error.message }))
      .finally(() => setLoadingDetail(false));
  }, [selectedIncidentId, page]);

  useEffect(() => {
    if (page === 'profile' && status === 'authenticated') {
      loadProfileData();
    }
  }, [page, status]);

  useEffect(() => {
    if (page === 'authority' && showAuthorityRoute) {
      loadAuthorityData();
      const interval = window.setInterval(() => loadAuthorityData(), 15000);
      return () => window.clearInterval(interval);
    }
    return undefined;
  }, [page, showAuthorityRoute, authorityFilters.parish, authorityFilters.status]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (page === 'trends') {
      loadTrendData(
        trendsBundle.period,
        trendsBundle.parish,
        trendsBundle.dateFrom,
        trendsBundle.dateTo
      );
    }
  }, [page, trendsBundle.period, trendsBundle.parish, trendsBundle.dateFrom, trendsBundle.dateTo]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return undefined;
    }

    const channel = supabase
      .channel('postalert-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'incidents' },
        () => {
          startTransition(() => {
            loadIncidents(1, false, true);
            if (selectedIncidentId) {
              apiRequest(`/api/incidents/${selectedIncidentId}`)
                .then(({ incident }) => setDetailIncident(incident))
                .catch(() => {});
            }
            if (page === 'authority') {
              loadAuthorityData();
            }
            if (page === 'profile' && status === 'authenticated') {
              loadProfileData();
            }
            if (page === 'trends') {
              loadTrendData(
                trendsBundle.period,
                trendsBundle.parish,
                trendsBundle.dateFrom,
                trendsBundle.dateTo
              );
            }
          });
        }
      )
      .subscribe();

    realtimeRef.current = channel;

    return () => {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current);
        realtimeRef.current = null;
      }
    };
  }, [page, selectedIncidentId, status, trendsBundle.period, trendsBundle.parish, trendsBundle.dateFrom, trendsBundle.dateTo]);

  // Polling fallback for real-time updates (every 30 seconds)
  useEffect(() => {
    if (page !== 'feed' && page !== 'authority') {
      return undefined;
    }

    const pollInterval = setInterval(() => {
      startTransition(() => {
        loadIncidents(1, false, true);
        if (page === 'authority') {
          loadAuthorityData();
        }
      });
    }, 30000);

    return () => clearInterval(pollInterval);
  }, [page]);

  useEffect(() => {
    const target = listEndRef.current;
    if (!target || page !== 'feed' || feedView !== 'list') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingFeed) {
          loadIncidents(pageNumber + 1, true);
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [page, feedView, hasMore, loadingFeed, pageNumber]);

  useEffect(() => {
    if (online && status === 'authenticated' && queue.length) {
      flushQueuedReports();
    }
  }, [online, status, queue.length]);

  async function loadIncidents(nextPage = 1, append = false, silent = false) {
    if (!silent) {
      setLoadingFeed(true);
    }
    const query = new URLSearchParams();
    if (filters.categories.length) {
      query.set('categories', filters.categories.join(','));
    }
    if (filters.severities.length) {
      query.set('severities', filters.severities.join(','));
    }
    if (filters.parish) {
      query.set('parish', filters.parish);
    }
    query.set('page', String(nextPage));
    query.set('limit', '8');
    query.set('startTime', createStartTime(filters.timeRange));

    try {
      const response = await apiRequest(`/api/incidents?${query.toString()}`);
      setPageNumber(nextPage);
      setHasMore(response.hasMore);
      setIncidents((current) => {
        const items = append
          ? [...current, ...response.items.filter((item) => !current.some((entry) => entry.id === item.id))]
          : response.items;
        writeToStorage(INCIDENT_CACHE_KEY, items);
        return items;
      });
    } catch (error) {
      if (!online) {
        setIncidents(readFromStorage(INCIDENT_CACHE_KEY, []));
        setFlash({
          tone: 'warning',
          message: 'Offline mode: showing cached incidents from the last successful sync.'
        });
      } else if (!silent) {
        setFlash({ tone: 'error', message: error.message });
      }
    } finally {
      if (!silent) {
        setLoadingFeed(false);
      }
    }
  }

  async function loadProfileData() {
    try {
      const [profile, incidentsResponse, activity] = await Promise.all([
        apiRequest('/api/profile'),
        apiRequest('/api/profile/incidents'),
        apiRequest('/api/profile/activity')
      ]);
      setProfileBundle({
        ...profile,
        incidents: incidentsResponse.items
      });
      setActivityBundle(activity);
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function loadAuthorityData() {
    try {
      const searchParams = new URLSearchParams();
      if (authorityFilters.parish) {
        searchParams.set('parish', authorityFilters.parish);
      }
      if (authorityFilters.status) {
        searchParams.set('status', authorityFilters.status);
      }
      const response = await apiRequest(`/api/authority/dashboard?${searchParams.toString()}`);
      setDashboard(response);
      const latestHighSeverity = response.incidents.find(
        (incident) =>
          (incident.severity === 'high' || incident.severity === 'critical') &&
          Date.now() - new Date(incident.createdAt).getTime() < 30 * 60 * 1000
      );
      if (latestHighSeverity) {
        setAuthorityAlert(latestHighSeverity);
        if (latestHighSeverity.id !== lastAuthorityAlertIdRef.current) {
          lastAuthorityAlertIdRef.current = latestHighSeverity.id;
          playAlertTone();
        }
      } else {
        setAuthorityAlert(null);
      }
      if (currentUser?.role === 'admin') {
        const pending = await apiRequest('/api/admin/authorities/pending');
        setPendingAuthorities(pending.items);
      }
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function loadTrendData(period, parish, dateFrom = '', dateTo = '') {
    try {
      const createSuffix = (nextPeriod) =>
        new URLSearchParams({
          period: nextPeriod,
          ...(parish ? { parish } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {})
        }).toString();

      const [counts, heatmap, top, counts24h, counts7d, counts30d] = await Promise.all([
        apiRequest(`/api/trends/counts?${createSuffix(period)}`),
        apiRequest(`/api/trends/heatmap?${createSuffix(period)}`),
        apiRequest(`/api/trends/top-categories?${createSuffix(period)}`),
        apiRequest(`/api/trends/counts?${createSuffix('24h')}`),
        apiRequest(`/api/trends/counts?${createSuffix('7d')}`),
        apiRequest(`/api/trends/counts?${createSuffix('30d')}`)
      ]);
      setTrendsBundle({
        counts: counts.counts,
        total: counts.total,
        heatmap: heatmap.items,
        top: top.items,
        summary: {
          '24h': counts24h.total,
          '7d': counts7d.total,
          '30d': counts30d.total
        },
        period,
        parish,
        dateFrom,
        dateTo
      });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  function clearAuthErrors(field) {
    if (!field) {
      setAuthErrors({});
      return;
    }

    setAuthErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleAuth(mode, payload) {
    try {
      clearAuthErrors();
      setAuthConfirmation(null);
      setResetPreview(null);
      if (mode === 'login') {
        await apiRequest('/api/auth/login', {
          method: 'POST',
          body: {
            email: payload.email,
            password: payload.password
          }
        });
        const result = await signIn('credentials', {
          email: payload.email,
          password: payload.password,
          redirect: false
        });
        if (result?.error) {
          throw new Error('Sign in failed. Please try again.');
        }
      } else {
        await apiRequest('/api/auth/register', {
          method: 'POST',
          body: {
            ...payload,
            kind: mode === 'authority' ? 'authority' : 'citizen'
          }
        });
        const result = await signIn('credentials', {
          email: payload.email,
          password: payload.password,
          redirect: false
        });
        if (result?.error) {
          throw new Error('Registration succeeded, but sign-in failed.');
        }
      }
      await update();
      if (mode === 'login') {
        setFlash({
          tone: 'success',
          message: 'Authentication successful.'
        });
        router.push(postAuthPath);
        return;
      }

      setAuthConfirmation({
        title:
          mode === 'authority'
            ? 'Authority account created successfully'
            : 'Account created successfully',
        message:
          mode === 'authority'
            ? 'Your authority account is now active in read-only mode until an administrator approves verification.'
            : 'Your citizen account is ready. You are signed in and can continue to the live incident feed.',
        email: payload.email
      });
    } catch (error) {
      const fieldErrors = getAuthFieldErrors(error);
      if (fieldErrors) {
        setAuthErrors(fieldErrors);
        setFlash(null);
        return;
      }

      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function requestPasswordReset(email) {
    try {
      const response = await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: { email }
      });
      setResetPreview({
        email,
        token: response.resetToken || '',
        expiresAt: response.expiresAt || ''
      });
      setFlash({
        tone: 'success',
        message: response.resetToken
          ? 'Reset instructions generated. In local development, use the token shown below.'
          : 'If that email is registered, reset instructions have been issued.'
      });
      return response;
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
      return null;
    }
  }

  async function completePasswordReset(token, password) {
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'PUT',
        body: { token, password }
      });
      setResetPreview(null);
      setFlash({
        tone: 'success',
        message: 'Password updated successfully. Sign in with your new password.'
      });
      return true;
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
      return false;
    }
  }

  function continueFromAuthConfirmation() {
    if (!authConfirmation) {
      return;
    }
    setFlash({
      tone: 'success',
      message: authConfirmation.title
    });
    setAuthConfirmation(null);
    router.push(postAuthPath);
  }

  async function submitReport(payload) {
    if (status !== 'authenticated') {
      router.push('/auth');
      return;
    }

    if (!online) {
      const queued = [...queue, { ...payload, queuedAt: new Date().toISOString() }];
      setQueue(queued);
      writeToStorage(REPORT_QUEUE_KEY, queued);
      setFlash({
        tone: 'warning',
        message: 'You are offline. This incident has been queued and will submit automatically when the connection returns.'
      });
      return;
    }

    try {
      const response = await apiRequest('/api/incidents', {
        method: 'POST',
        body: payload
      });
      broadcast('incident-notification', {
        incident: response.incident
      });
      broadcast('refresh-incidents');
      setFlash({
        tone: 'success',
        message: response.photoWarning || 'Incident submitted successfully.'
      });
      await loadIncidents(1, false);
      openIncidentPage(response.incident.id, router);
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function flushQueuedReports() {
    const items = [...queue];
    let submittedCount = 0;
    for (const queued of items) {
      try {
        const response = await apiRequest('/api/incidents', {
          method: 'POST',
          body: queued
        });
        broadcast('incident-notification', {
          incident: response.incident
        });
        submittedCount += 1;
        setQueue((current) => {
          const nextItems = current.filter((entry) => entry.queuedAt !== queued.queuedAt);
          writeToStorage(REPORT_QUEUE_KEY, nextItems);
          return nextItems;
        });
      } catch {
        break;
      }
    }
    if (submittedCount) {
      broadcast('refresh-incidents');
      setFlash({ tone: 'success', message: 'Queued offline reports were submitted.' });
      loadIncidents(1, false);
    }
  }

  async function handleVote(action) {
    if (status !== 'authenticated' || !selectedIncidentId) {
      router.push('/auth');
      return;
    }
    try {
      await apiRequest(`/api/incidents/${selectedIncidentId}/${action}`, {
        method: 'POST'
      });
      const detail = await apiRequest(`/api/incidents/${selectedIncidentId}`);
      setDetailIncident(detail.incident);
      broadcast('refresh-incidents');
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function handleAuthorityAction(incidentId, action, notes) {
    try {
      const response = await apiRequest(`/api/authority/incidents/${incidentId}/${action}`, {
        method: 'POST',
        body: { notes }
      });
      if (detailIncident?.id === incidentId) {
        setDetailIncident(response.incident);
      }
      broadcast('refresh-incidents');
      broadcast('refresh-authority');
      broadcast('refresh-profile');
      await Promise.all([loadIncidents(1, false), loadAuthorityData()]);
      setFlash({ tone: 'success', message: `Authority action "${action}" recorded.` });
      return true;
    } catch (error) {
      if (error.code === 4093) {
        await Promise.all([
          loadAuthorityData(),
          detailIncident?.id === incidentId ? apiRequest(`/api/incidents/${incidentId}`) : Promise.resolve(null)
        ]).then(([, detail]) => {
          if (detail?.incident) {
            setDetailIncident(detail.incident);
          }
        }).catch(() => {});
      }
      setFlash({ tone: 'error', message: error.message });
      return false;
    }
  }

  async function approveAuthority(authorityId) {
    try {
      await apiRequest(`/api/admin/authorities/${authorityId}/approve`, {
        method: 'POST'
      });
      setPendingAuthorities((current) => current.filter((entry) => entry.id !== authorityId));
      setFlash({ tone: 'success', message: 'Authority account approved.' });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function updateProfile(payload) {
    try {
      await apiRequest('/api/profile', {
        method: 'PUT',
        body: payload
      });
      await loadProfileData();
      await update();
      setFlash({ tone: 'success', message: 'Profile saved.' });
      broadcast('refresh-profile');
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function updateNotificationPrefs(payload) {
    try {
      if (payload.enabled && window.Notification && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setFlash({ tone: 'warning', message: 'Notification permission was not granted.' });
          return;
        }
        await apiRequest('/api/notifications/register', {
          method: 'POST',
          body: {
            token: window.crypto.randomUUID(),
            platform: 'web'
          }
        });
      }
      await apiRequest('/api/notifications/preferences', {
        method: 'PUT',
        body: payload
      });
      await loadProfileData();
      await update();
      setFlash({ tone: 'success', message: 'Notification preferences updated.' });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function submitAppeal(payload) {
    try {
      await apiRequest('/api/moderation/appeals', {
        method: 'POST',
        body: payload
      });
      await loadProfileData();
      setFlash({ tone: 'success', message: 'Strike appeal submitted.' });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function createIncidentComment(message) {
    if (status !== 'authenticated' || !selectedIncidentId) {
      router.push('/auth');
      return;
    }

    try {
      await apiRequest(`/api/incidents/${selectedIncidentId}/comments`, {
        method: 'POST',
        body: { message }
      });
      const detail = await apiRequest(`/api/incidents/${selectedIncidentId}`);
      setDetailIncident(detail.incident);
      broadcast('refresh-incidents');
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function deleteIncidentComment(commentId) {
    if (status !== 'authenticated' || !selectedIncidentId) {
      router.push('/auth');
      return;
    }

    try {
      await apiRequest(`/api/incidents/${selectedIncidentId}/comments`, {
        method: 'DELETE',
        body: { commentId }
      });
      const detail = await apiRequest(`/api/incidents/${selectedIncidentId}`);
      setDetailIncident(detail.incident);
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  if (page === 'auth') {
    return (
      <AuthExperience
        currentUser={currentUser}
        flash={flash}
        onContinue={() => router.push(postAuthPath)}
        onSignOut={() => signOut({ callbackUrl: '/' })}
      >
        <AuthScreen
          confirmation={authConfirmation}
          errors={authErrors}
          initialMode={initialAuthMode}
          onClearError={clearAuthErrors}
          onClearErrors={() => clearAuthErrors()}
          onContinue={continueFromAuthConfirmation}
          onRequestReset={requestPasswordReset}
          onResetPassword={completePasswordReset}
          onSubmit={handleAuth}
          resetPreview={resetPreview}
        />
      </AuthExperience>
    );
  }

  const headerIdentity = !currentUser
    ? 'Public view'
    : currentUser.role === 'authority_pending'
      ? 'Authority pending'
      : currentUser.permanentPostingBan
        ? 'Posting suspended'
      : currentUser.restrictedUntil
          ? 'Posting restricted'
          : currentUser.role === 'authority' || currentUser.role === 'admin'
            ? 'Authority access'
            : 'Citizen access';
  const headerNavItems = [
    { href: '/feed', label: 'Feed' },
    { href: '/report', label: 'Report' },
    { href: '/trends', label: 'Trends' },
    ...(showAuthorityRoute ? [{ href: '/authority', label: 'Authority' }] : []),
    ...(currentUser ? [{ href: '/profile', label: 'Profile' }] : [])
  ];

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="app-grid absolute inset-0 pointer-events-none opacity-70" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--surface)]/85 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <Link href="/feed" className="flex min-w-0 items-center gap-4">
              <div className="brand-mark">
                <RadioTower aria-hidden="true" className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-display truncate text-2xl tracking-[0.02em] text-white">
                  PostAlert
                </p>
              </div>
            </Link>

            <nav className="hidden items-center gap-1 xl:gap-2 lg:flex">
              {headerNavItems.map((item) => (
                <HeaderLink key={item.href} href={item.href}>
                  {item.label}
                </HeaderLink>
              ))}
            </nav>

            <div className="flex items-center gap-2 xl:gap-3">
              <div className="hidden lg:block">
                <StatusPill online={online} mode={status} />
              </div>
              <HeaderAccountPill label={headerIdentity} name={currentUser?.name || 'Read-only public view'} />
              {currentUser ? (
                <button
                  className="ghost-button hidden whitespace-nowrap px-5 lg:inline-flex"
                  onClick={() => signOut({ callbackUrl: '/' })}
                >
                  Sign out
                </button>
              ) : null}
              <button
                aria-expanded={mobileNavOpen}
                aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
                className="ghost-button h-12 w-12 shrink-0 p-0 lg:hidden"
                onClick={() => setMobileNavOpen((current) => !current)}
                type="button"
              >
                {mobileNavOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {mobileNavOpen ? (
            <div className="mt-4 lg:hidden">
              <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,24,38,0.98),rgba(23,34,51,0.94))] p-4 shadow-[0_26px_60px_rgba(3,8,20,0.34)]">
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatusPill online={online} mode={status} />
                  <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3">
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {headerIdentity}
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold text-white">
                      {currentUser?.name || 'Read-only public view'}
                    </div>
                  </div>
                </div>

                <nav className="mt-4 grid gap-2">
                  {headerNavItems.map((item) => (
                    <HeaderLink
                      key={item.href}
                      href={item.href}
                      className="block w-full rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4 text-left text-slate-100"
                      onClick={() => setMobileNavOpen(false)}
                    >
                      {item.label}
                    </HeaderLink>
                  ))}
                </nav>

                {currentUser ? (
                  <button
                    className="ghost-button mt-4 w-full justify-start rounded-[20px] px-4 py-4"
                    onClick={() => {
                      setMobileNavOpen(false);
                      signOut({ callbackUrl: '/' });
                    }}
                    type="button"
                  >
                    Sign out
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      {flash ? <FlashBanner flash={flash} /> : null}
      {!online ? <OfflineBanner queueCount={queue.length} /> : null}
      {authorityAlert && showAuthorityRoute ? (
        <AlertRibbon incident={authorityAlert} onDismiss={() => setAuthorityAlert(null)} />
      ) : null}

      <main className="relative z-10 mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        {page !== 'incident' ? (
          <HeroStrip
            user={currentUser}
            queueCount={queue.length}
            incidentCount={incidents.length}
          />
        ) : null}

        {page === 'feed' ? (
          <FeedScreen
            incidents={incidents}
            loading={loadingFeed}
            hasMore={hasMore}
            filters={filters}
            feedView={feedView}
            listEndRef={listEndRef}
            pageNumber={pageNumber}
            onFiltersChange={setFilters}
            onPageChange={(nextPage) => loadIncidents(nextPage, false)}
            onViewChange={setFeedView}
            onOpenIncident={(incidentId) => openIncidentPreview(incidentId, router, searchParams)}
            selectedIncidentId={selectedIncidentId}
            userLocation={currentUser?.lastKnownLocation}
          />
        ) : null}

        {page === 'incident' ? (
          <IncidentDetailPage
            incident={detailIncident}
            incidentId={selectedIncidentId}
            loading={loadingDetail}
            user={currentUser}
            onCommentCreate={createIncidentComment}
            onCommentDelete={deleteIncidentComment}
            onConfirm={() => handleVote('confirm')}
            onDispute={() => handleVote('dispute')}
            onAuthorityAction={handleAuthorityAction}
          />
        ) : null}

        {page === 'auth' ? (
        <AuthScreen
          confirmation={authConfirmation}
          errors={authErrors}
          initialMode={initialAuthMode}
          onClearError={clearAuthErrors}
          onClearErrors={() => clearAuthErrors()}
          onContinue={continueFromAuthConfirmation}
          onRequestReset={requestPasswordReset}
          onResetPassword={completePasswordReset}
            onSubmit={handleAuth}
            resetPreview={resetPreview}
          />
        ) : null}

        {page === 'report' ? (
          status === 'loading' ? (
            <LoadingSurface message="Loading secure report tools..." />
          ) : currentUser ? (
            <ReportWizard canPost={canPost} onSubmit={submitReport} user={currentUser} />
          ) : (
            <ProtectedMessage href="/auth" title="Sign in to report incidents" />
          )
        ) : null}

        {page === 'authority' ? (
          status === 'loading' ? (
            <LoadingSurface message="Loading authority workspace..." />
          ) : showAuthorityRoute ? (
            <AuthorityScreen
              dashboard={dashboard}
              filters={authorityFilters}
              pendingAuthorities={pendingAuthorities}
              user={currentUser}
              onAction={handleAuthorityAction}
              onFiltersChange={setAuthorityFilters}
              onApprove={approveAuthority}
            />
          ) : (
            <ProtectedMessage href="/feed" title="Authority access is restricted to verified accounts" />
          )
        ) : null}

        {page === 'trends' ? (
            <TrendsScreen
              trendsBundle={trendsBundle}
              onChangePeriod={(period) =>
                setTrendsBundle((current) => ({ ...current, period }))
              }
              onChangeParish={(parish) =>
                setTrendsBundle((current) => ({ ...current, parish }))
              }
              onChangeDateFrom={(dateFrom) =>
                setTrendsBundle((current) => ({ ...current, dateFrom }))
              }
              onChangeDateTo={(dateTo) =>
                setTrendsBundle((current) => ({ ...current, dateTo }))
              }
            />
        ) : null}

        {page === 'profile' ? (
          status === 'loading' ? (
            <LoadingSurface message="Loading profile..." />
          ) : currentUser ? (
            <ProfileScreen
              bundle={profileBundle}
              activityBundle={activityBundle}
              onSave={updateProfile}
              onPreferencesSave={updateNotificationPrefs}
              onAppeal={submitAppeal}
            />
          ) : (
            <ProtectedMessage href="/auth" title="Sign in to view your profile" />
          )
        ) : null}
      </main>

      {page === 'feed' ? (
        <IncidentDrawer
          incident={detailIncident}
          loading={loadingDetail}
          user={currentUser}
          onClose={() => closeIncidentPreview(router, searchParams)}
          onConfirm={() => handleVote('confirm')}
          onCommentCreate={createIncidentComment}
          onCommentDelete={deleteIncidentComment}
          onDispute={() => handleVote('dispute')}
          onAuthorityAction={handleAuthorityAction}
        />
      ) : null}
    </div>
  );
}

function HeaderLink({ href, children, className = '', onClick }) {
  const pathname = usePathname();
  const active =
    pathname === href || (href === '/feed' && pathname?.startsWith('/incidents/'));
  return (
    <Link
      href={href}
      className={`nav-link ${active ? 'nav-link-active' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

function StatusPill({ online, mode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-3 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-300 whitespace-nowrap">
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-300' : 'bg-amber-300'}`} />
      <span className={online ? 'text-emerald-300' : 'text-amber-300'}>
        {online ? (mode === 'authenticated' ? 'Session live' : 'Online') : 'Offline'}
      </span>
    </div>
  );
}

function HeaderAccountPill({ label, name }) {
  return (
    <div className="hidden min-w-0 items-center gap-3 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2.5 text-slate-300 md:inline-flex">
      <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400 whitespace-nowrap">
        {label}
      </div>
      <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
      <div className="max-w-[10rem] truncate text-sm font-semibold text-white">{name}</div>
    </div>
  );
}

function FlashBanner({ flash }) {
  const tones = {
    success: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100',
    error: 'border-rose-500/30 bg-rose-500/15 text-rose-100',
    warning: 'border-amber-500/30 bg-amber-500/15 text-amber-100'
  };

  return (
    <div
      aria-live="polite"
      className={`mx-auto mt-4 max-w-7xl rounded-3xl border px-4 py-3 text-sm ${tones[flash.tone]}`}
    >
      {flash.message}
    </div>
  );
}

function OfflineBanner({ queueCount }) {
  return (
    <div
      aria-live="polite"
      className="mx-auto mt-4 flex max-w-7xl items-center justify-between rounded-3xl border border-amber-500/30 bg-amber-500/12 px-4 py-3 text-sm text-amber-100"
    >
      <span>Connection lost. Cached incidents remain available.</span>
      <span>{queueCount} queued report{queueCount === 1 ? '' : 's'}</span>
    </div>
  );
}

function AlertRibbon({ incident, onDismiss }) {
  return (
    <div className="mx-auto mt-4 flex max-w-7xl items-center justify-between gap-4 rounded-3xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-sm text-rose-50">
      <div className="flex items-center gap-3">
        <Siren aria-hidden="true" className="h-5 w-5" />
        <span>
          High-severity alert in {incident.parish}: {incident.title}
        </span>
      </div>
      <button className="ghost-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function HeroStrip({ user, queueCount, incidentCount }) {
  return (
    <section className="hero-panel">
      <div className="max-w-2xl space-y-4">
        <p className="text-xs uppercase tracking-[0.35em] text-amber-300">Crowdsourced emergency intelligence</p>
        <h1 className="font-display text-4xl leading-none text-white md:text-5xl">
          Report fast. Verify faster. Keep Jamaica informed in real time.
        </h1>
        <p className="max-w-xl text-sm leading-7 text-slate-300 md:text-base">
          PostAlert runs through Next.js with Auth.js sessions, route-handler APIs, Supabase-ready data wiring, and a Vercel deployment shape.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Live incidents" value={String(incidentCount)} icon={MapPinned} />
        <StatCard label="Queued offline reports" value={String(queueCount)} icon={Clock3} />
        <StatCard label="Access level" value={user?.role || 'public'} icon={user ? UserRound : ShieldCheck} />
      </div>
    </section>
  );
}

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
      <div className="mb-6 inline-flex rounded-2xl border border-white/10 bg-white/10 p-3 text-amber-300">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </div>
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 font-display text-3xl text-white">{value}</div>
    </div>
  );
}

function FeedScreen({
  incidents,
  loading,
  hasMore,
  filters,
  feedView,
  pageNumber,
  onFiltersChange,
  onPageChange,
  onViewChange,
  onOpenIncident,
  selectedIncidentId,
  userLocation,
  listEndRef
}) {
  const [previewIncident, setPreviewIncident] = useState(null);

  return (
    <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="surface-card">
        <div className="section-kicker">Feed Controls</div>
        <h2 className="font-display text-2xl text-white">Incident intelligence feed</h2>
        <p className="mt-2 text-sm text-slate-300">
          Filter by incident type, severity, parish, and time window.
        </p>

        <div className="mt-6 space-y-6">
          <FilterPanel filters={filters} onChange={onFiltersChange} />
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">View mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button className={`toggle-button ${feedView === 'map' ? 'toggle-button-active' : ''}`} onClick={() => onViewChange('map')}>
                <LayoutGrid aria-hidden="true" className="h-4 w-4" />
                Map
              </button>
              <button className={`toggle-button ${feedView === 'list' ? 'toggle-button-active' : ''}`} onClick={() => onViewChange('list')}>
                <LayoutList aria-hidden="true" className="h-4 w-4" />
                List
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="space-y-6">
        {feedView === 'map' ? (
          <div className="surface-card">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <div className="section-kicker">Map Feed</div>
                <h2 className="font-display text-2xl text-white">Live incident map</h2>
              </div>
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-300">
                {incidents.length} visible markers
              </div>
            </div>

            {MAPBOX_ENABLED ? (
              <MapboxIncidentMap
                className="h-[30rem]"
                highlightedIncidentId={selectedIncidentId}
                incidents={incidents}
                onIncidentSelect={(incident) => setPreviewIncident(incident)}
                userLocation={userLocation}
              />
            ) : (
              <IncidentMap
                incidents={incidents}
                onSelect={(incident) => setPreviewIncident(incident)}
                userLocation={userLocation}
                highlightedIncidentId={selectedIncidentId}
              />
            )}

            <div className="mt-4 rounded-[24px] border border-white/10 bg-[var(--surface-2)] p-4">
              {previewIncident ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <CategoryBadge category={previewIncident.category} />
                      <SeverityBadge severity={previewIncident.severity} />
                    </div>
                    <div className="text-lg font-semibold text-white">{previewIncident.title}</div>
                    <div className="text-sm text-slate-300">
                      {formatAgo(previewIncident.createdAt)} · {previewIncident.confirmationCount} confirmations
                    </div>
                  </div>
                  <button className="primary-button" onClick={() => onOpenIncident(previewIncident.id)}>
                    Open incident
                  </button>
                </div>
              ) : (
                <div className="text-sm text-slate-400">
                  Select a marker to preview category, severity, time, and community confirmation volume.
                </div>
              )}
            </div>
          </div>
        ) : null}

        <div className="surface-card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="section-kicker">Incident List</div>
              <h2 className="font-display text-2xl text-white">Sorted by recency</h2>
            </div>
            {loading ? <div className="text-sm text-slate-400">Loading…</div> : null}
          </div>

          <div className="space-y-3">
            {incidents.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                selected={selectedIncidentId === incident.id}
                userLocation={userLocation}
                onClick={() => onOpenIncident(incident.id)}
              />
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div
              ref={listEndRef}
              className="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-400"
            >
              {hasMore ? 'Scroll for more incidents' : 'No more incidents'}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="ghost-button"
                disabled={pageNumber <= 1}
                onClick={() => onPageChange(Math.max(pageNumber - 1, 1))}
                type="button"
              >
                Previous
              </button>
              <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">
                Page {pageNumber}
              </div>
              <button
                className="ghost-button"
                disabled={!hasMore}
                onClick={() => onPageChange(pageNumber + 1)}
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FilterPanel({ filters, onChange }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="section-label">
          <Search aria-hidden="true" className="h-4 w-4" />
          Category
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(CATEGORY_META).map((category) => (
            <button
              key={category}
              className={`chip-button ${filters.categories.includes(category) ? 'chip-button-active' : ''}`}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  categories: current.categories.includes(category)
                    ? current.categories.filter((entry) => entry !== category)
                    : [...current.categories, category]
                }))
              }
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div className="section-label">
          <TriangleAlert aria-hidden="true" className="h-4 w-4" />
          Severity
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(SEVERITY_META).map((severity) => (
            <button
              key={severity}
              className={`chip-button ${filters.severities.includes(severity) ? 'chip-button-active' : ''}`}
              onClick={() =>
                onChange((current) => ({
                  ...current,
                  severities: current.severities.includes(severity)
                    ? current.severities.filter((entry) => entry !== severity)
                    : [...current.severities, severity]
                }))
              }
            >
              {SEVERITY_META[severity].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="section-label">
            <Clock3 aria-hidden="true" className="h-4 w-4" />
            Time range
          </span>
          <select
            className="field"
            value={filters.timeRange}
            onChange={(event) => onChange((current) => ({ ...current, timeRange: event.target.value }))}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
        <label className="space-y-2">
          <span className="section-label">
            <MapPinned aria-hidden="true" className="h-4 w-4" />
            Parish
          </span>
          <select
            className="field"
            value={filters.parish}
            onChange={(event) => onChange((current) => ({ ...current, parish: event.target.value }))}
          >
            <option value="">All parishes</option>
            {PARISHES.map((parish) => (
              <option key={parish} value={parish}>
                {parish}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function IncidentMap({ incidents, onSelect, userLocation, highlightedIncidentId, editable, value, onPick }) {
  const containerRef = useRef(null);

  function handleMapClick(event) {
    if (!editable || !containerRef.current) {
      return;
    }
    const bounds = containerRef.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const latitude = MAP_BOUNDS.latMax - y * (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin);
    const longitude = MAP_BOUNDS.lngMin + x * (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin);
    onPick({
      latitude: Number(latitude.toFixed(5)),
      longitude: Number(longitude.toFixed(5))
    });
  }

  return (
    <div ref={containerRef} className={`map-shell ${editable ? 'cursor-crosshair' : ''}`} onClick={handleMapClick}>
      <svg viewBox="0 0 100 60" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="map-sheen" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#111b2d" />
            <stop offset="100%" stopColor="#22354d" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="100" height="60" fill="url(#map-sheen)" rx="6" />
        <g stroke="rgba(255,255,255,0.06)" strokeWidth="0.3">
          {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((line) => (
            <line key={`v-${line}`} x1={line} y1="0" x2={line} y2="60" />
          ))}
          {[10, 20, 30, 40, 50].map((line) => (
            <line key={`h-${line}`} x1="0" y1={line} x2="100" y2={line} />
          ))}
        </g>
        <polygon
          points="10,33 16,28 25,24 34,23 41,21 53,18 69,18 80,22 88,27 90,32 87,35 81,38 72,41 58,43 43,45 28,45 17,42 10,37"
          fill="rgba(244,239,229,0.12)"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="0.7"
        />
      </svg>

      {userLocation?.lat && userLocation?.lng ? (
        <Marker incident={{ id: 'user-location', latitude: userLocation.lat, longitude: userLocation.lng, severity: 'low' }} variant="user" />
      ) : null}
      {incidents.map((incident) => (
        <Marker
          key={incident.id}
          incident={incident}
          highlighted={highlightedIncidentId === incident.id}
          onClick={(event) => {
            event.stopPropagation();
            if (!editable) {
              onSelect(incident);
            }
          }}
        />
      ))}
      {editable && value?.latitude && value?.longitude ? (
        <Marker incident={{ id: 'draft', latitude: value.latitude, longitude: value.longitude, severity: 'critical' }} variant="draft" />
      ) : null}
    </div>
  );
}

function Marker({ incident, onClick, highlighted, variant }) {
  const { left, top } = projectPoint(incident.latitude, incident.longitude);
  const styles = {
    low: 'marker-low',
    medium: 'marker-medium',
    high: 'marker-high',
    critical: 'marker-critical'
  };
  const className =
    variant === 'user'
      ? 'marker-user'
      : variant === 'draft'
        ? 'marker-draft'
        : styles[incident.severity] || 'marker-medium';

  return (
    <button
      aria-label={
        variant === 'user'
          ? 'Your saved location'
          : variant === 'draft'
            ? 'Draft incident location'
            : `${incident.title || incident.category} marker`
      }
      className={`map-marker ${className} ${highlighted ? 'scale-125 ring-2 ring-white/60' : ''}`}
      style={{ left: `${left}%`, top: `${top}%` }}
      onClick={onClick}
      type="button"
    />
  );
}

function IncidentCard({ incident, selected, onClick, userLocation }) {
  const Icon = CATEGORY_META[incident.category]?.icon || FALLBACK_CATEGORY_ICON;
  const distance = userLocation?.lat
    ? haversineKm(userLocation.lat, userLocation.lng, incident.latitude, incident.longitude).toFixed(1)
    : null;

  return (
    <button className={`incident-row ${selected ? 'incident-row-active' : ''}`} onClick={onClick} type="button">
      <div className={`icon-shell ${CATEGORY_META[incident.category]?.surface || 'bg-white/10'} ${CATEGORY_META[incident.category]?.accent || 'text-white'}`}>
        <Icon aria-hidden="true" className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-base font-semibold text-white">{incident.title}</div>
          <SeverityBadge severity={incident.severity} />
          <CredibilityBadge credibility={incident.credibility} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span>{incident.parish}</span>
          <span>{formatAgo(incident.createdAt)}</span>
          <span>{incident.confirmationCount} confirmations</span>
          {distance ? <span>{distance} km away</span> : null}
        </div>
      </div>
      <ChevronRight aria-hidden="true" className="h-5 w-5 text-slate-500" />
    </button>
  );
}

function IncidentDetailPage({
  incident,
  incidentId,
  loading,
  user,
  onCommentCreate,
  onCommentDelete,
  onConfirm,
  onDispute,
  onAuthorityAction
}) {
  if (loading && !incident) {
    return <div className="surface-card text-sm text-slate-400">Loading incident details…</div>;
  }

  if (!loading && !incident) {
    return (
      <div className="surface-card text-center">
        <h1 className="font-display text-3xl text-white">Incident not available</h1>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          We could not find an incident for ID {incidentId}.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/feed" className="primary-button">
            Back to feed
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="surface-card">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-3xl space-y-4">
            <Link href="/feed" className="ghost-button inline-flex items-center gap-2">
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              Back to feed
            </Link>
            <div>
              <div className="section-kicker">Incident detail</div>
              <h1 className="font-display text-4xl leading-none text-white md:text-5xl">
                {incident?.title || 'Incident detail'}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                {incident?.address || `${incident?.parish || 'Jamaica'}, Jamaica`}
              </p>
            </div>
            {incident ? (
              <div className="flex flex-wrap items-center gap-3">
                <CategoryBadge category={incident.category} />
                <SeverityBadge severity={incident.severity} />
                <StatusBadge status={incident.status} />
                <CredibilityBadge credibility={incident.credibility} />
              </div>
            ) : null}
          </div>

          {incident ? (
            <div className="grid w-full gap-4 sm:grid-cols-2 xl:w-[26rem]">
              <InfoBlock label="Reported">{formatDateTime(incident.createdAt)}</InfoBlock>
              <InfoBlock label="Reporter">
                {incident.reporter?.name} · {incident.reporter?.parish}
              </InfoBlock>
              <InfoBlock label="Confirmations">{incident.confirmationCount}</InfoBlock>
              <InfoBlock label="Disputes">{incident.disputeCount}</InfoBlock>
            </div>
          ) : null}
        </div>
      </div>

      <IncidentDetailContent
        incident={incident}
        layout="page"
        loading={loading}
        user={user}
        onCommentCreate={onCommentCreate}
        onCommentDelete={onCommentDelete}
        onConfirm={onConfirm}
        onDispute={onDispute}
        onAuthorityAction={onAuthorityAction}
      />
    </section>
  );
}

function AuthorityActionComposer({
  actionLabel = 'Record authority action',
  buttonGridClassName = 'sm:grid-cols-2',
  incident,
  notes,
  onAction,
  onNotesChange,
  pendingAction = '',
  readOnly = false
}) {
  const recordedAction = incident.authorityActions?.[0] || null;
  const controlsDisabled = readOnly || Boolean(recordedAction) || Boolean(pendingAction);

  return (
    <>
      <div className="section-label">{actionLabel}</div>
      <textarea
        className="field min-h-24"
        disabled={controlsDisabled}
        onChange={(event) => onNotesChange(event.target.value)}
        placeholder="Add operational notes for the public record."
        value={notes}
      />
      {recordedAction ? (
        <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/12 p-4 text-sm text-amber-100">
          <div className="font-semibold text-white">Authority action already recorded</div>
          <div className="mt-2">
            {recordedAction.action} by {recordedAction.authorityName} · {formatDateTime(recordedAction.createdAt)}
          </div>
          {recordedAction.notes ? <div className="mt-2 text-amber-100/90">{recordedAction.notes}</div> : null}
        </div>
      ) : null}
      <div className={`grid gap-2 ${buttonGridClassName}`}>
        {AUTHORITY_ACTION_OPTIONS.map((action) => (
          <button
            key={action}
            className={`ghost-button ${action === 'dismiss' ? '!border-rose-500/30 !text-rose-100' : ''}`}
            disabled={controlsDisabled}
            onClick={() => onAction(action)}
            type="button"
          >
            {pendingAction === action ? 'Recording…' : action}
          </button>
        ))}
      </div>
    </>
  );
}

function IncidentDetailContent({
  incident,
  layout = 'drawer',
  loading,
  user,
  onCommentCreate,
  onCommentDelete,
  onConfirm,
  onDispute,
  onAuthorityAction
}) {
  const [notes, setNotes] = useState('');
  const [comment, setComment] = useState('');
  const [pendingAuthorityAction, setPendingAuthorityAction] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const sectionClassName =
    layout === 'page' ? 'surface-card space-y-5' : 'surface-muted';

  useEffect(() => {
    setNotes('');
    setComment('');
    setPendingAuthorityAction('');
    setSelectedPhoto(null);
  }, [incident?.id]);

  async function submitAuthorityAction(action) {
    setPendingAuthorityAction(action);
    const success = await onAuthorityAction(incident.id, action, notes);
    if (success) {
      setNotes('');
    }
    setPendingAuthorityAction('');
  }

  if (loading && !incident) {
    return (
      <div className={layout === 'page' ? 'surface-card text-sm text-slate-400' : 'p-6 text-sm text-slate-400'}>
        Loading incident details…
      </div>
    );
  }

  if (!incident) {
    return (
      <div className={layout === 'page' ? 'surface-card text-sm text-slate-400' : 'p-6 text-sm text-slate-400'}>
        Incident details are unavailable.
      </div>
    );
  }

  return (
    <>
      <PhotoLightbox photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />

      <div className={layout === 'page' ? 'grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_20rem]' : 'space-y-6 p-6'}>
        <div className="space-y-6">
          {layout === 'drawer' ? (
            <div className="flex flex-wrap items-center gap-3">
              <CategoryBadge category={incident.category} />
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>
          ) : null}

          <div className={sectionClassName}>
            <div className="section-label">Full description</div>
            <p className="text-sm leading-7 text-slate-300">{incident.description}</p>
          </div>

          {layout === 'drawer' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <InfoBlock label="Reported">{formatDateTime(incident.createdAt)}</InfoBlock>
              <InfoBlock label="Reporter">
                {incident.reporter?.name} · {incident.reporter?.parish}
              </InfoBlock>
              <InfoBlock label="Confirmations">{incident.confirmationCount}</InfoBlock>
              <InfoBlock label="Disputes">{incident.disputeCount}</InfoBlock>
            </div>
          ) : null}

          <div className={sectionClassName}>
            <div className="section-label">Incident map</div>
            {MAPBOX_ENABLED ? (
              <MapboxIncidentMap
                className="h-[22rem]"
                highlightedIncidentId={incident.id}
                incidents={[incident]}
                singleIncident
                userLocation={null}
              />
            ) : (
              <IncidentMap
                highlightedIncidentId={incident.id}
                incidents={[incident]}
                onSelect={() => {}}
                userLocation={null}
              />
            )}
          </div>

          {incident.photos?.length ? (
            <div className={sectionClassName}>
              <div className="section-label">Uploaded photos</div>
              <div className="grid gap-3 sm:grid-cols-2">
                {incident.photos.map((photo) => (
                  <button
                    key={photo.id}
                    className="group overflow-hidden rounded-[24px] border border-white/10"
                    onClick={() => setSelectedPhoto(photo)}
                    type="button"
                  >
                    <img
                      alt={photo.name}
                      className="h-48 w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      src={photo.url}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={sectionClassName}>
            <div className="section-label">Community confirmations</div>
            <div className="space-y-2 text-sm text-slate-300">
              {incident.confirmations?.length ? incident.confirmations.map((confirmation) => (
                <div
                  key={confirmation.id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <span>{confirmation.userName}</span>
                  <span className="text-slate-400">
                    {confirmation.action} · {formatAgo(confirmation.createdAt)}
                  </span>
                </div>
              )) : <div className="text-slate-400">No community actions yet.</div>}
            </div>
          </div>

          {layout === 'drawer' ? (
            <div className={sectionClassName}>
              <div className="section-label">Authority actions</div>
              <div className="space-y-2 text-sm text-slate-300">
                {incident.authorityActions?.length ? incident.authorityActions.map((action) => (
                  <div key={action.id} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                    <div className="font-semibold text-white">{action.action}</div>
                    <div className="mt-1 text-slate-400">
                      {action.authorityName} · {formatDateTime(action.createdAt)}
                    </div>
                    {action.notes ? <div className="mt-2">{action.notes}</div> : null}
                  </div>
                )) : <div className="text-slate-400">No authority actions have been recorded.</div>}
              </div>
            </div>
          ) : null}

          <div className={sectionClassName}>
            <div className="section-label">Comments</div>
            <div className="space-y-3">
              {incident.comments?.length ? incident.comments.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">{entry.author.name}</div>
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                        {entry.author.parish} · {formatAgo(entry.createdAt)}
                      </div>
                    </div>
                    {entry.canDelete ? (
                      <button
                        className="ghost-button"
                        onClick={() => onCommentDelete(entry.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 text-sm leading-7 text-slate-300">{entry.message}</div>
                </div>
              )) : <div className="text-slate-400">No discussion yet.</div>}
            </div>
            {user ? (
              <div className="mt-4 space-y-3">
                <textarea
                  className="field min-h-24"
                  placeholder="Add context or clarification for this incident."
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
                <button
                  className="primary-button"
                  disabled={!comment.trim()}
                  onClick={() => {
                    onCommentCreate(comment.trim());
                    setComment('');
                  }}
                  type="button"
                >
                  Post comment
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {layout === 'page' ? (
          <div className="space-y-6">
            {user && incident.canAct ? (
              <div className="surface-card space-y-4">
                <div className="section-label">Community action</div>
                <div className="grid gap-3">
                  <button className="primary-button" onClick={onConfirm} type="button">
                    Confirm incident
                  </button>
                  <button
                    className="ghost-button !border-rose-500/30 !text-rose-100"
                    onClick={onDispute}
                    type="button"
                  >
                    Dispute report
                  </button>
                </div>
              </div>
            ) : null}

            <div className="surface-card space-y-4">
              <div className="section-label">Authority actions</div>
              <div className="space-y-2 text-sm text-slate-300">
                {incident.authorityActions?.length ? incident.authorityActions.map((action) => (
                  <div key={action.id} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
                    <div className="font-semibold text-white">{action.action}</div>
                    <div className="mt-1 text-slate-400">
                      {action.authorityName} · {formatDateTime(action.createdAt)}
                    </div>
                    {action.notes ? <div className="mt-2">{action.notes}</div> : null}
                  </div>
                )) : <div className="text-slate-400">No authority actions have been recorded.</div>}
              </div>
            </div>

            {user?.role === 'authority' || user?.role === 'admin' ? (
              <div className="surface-card space-y-4">
                <AuthorityActionComposer
                  actionLabel="Record authority action"
                  buttonGridClassName="sm:grid-cols-2"
                  incident={incident}
                  notes={notes}
                  onAction={submitAuthorityAction}
                  onNotesChange={setNotes}
                  pendingAction={pendingAuthorityAction}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {layout === 'drawer' ? (
          <>
            {user && incident.canAct ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="primary-button" onClick={onConfirm} type="button">
                  Confirm
                </button>
                <button
                  className="ghost-button !border-rose-500/30 !text-rose-100"
                  onClick={onDispute}
                  type="button"
                >
                  Dispute
                </button>
              </div>
            ) : null}

            {user?.role === 'authority' || user?.role === 'admin' ? (
              <div className="space-y-3 rounded-[28px] border border-white/10 bg-white/5 p-4">
                <AuthorityActionComposer
                  actionLabel="Authority action"
                  buttonGridClassName="sm:grid-cols-4"
                  incident={incident}
                  notes={notes}
                  onAction={submitAuthorityAction}
                  onNotesChange={setNotes}
                  pendingAction={pendingAuthorityAction}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}

function PhotoLightbox({ photo, onClose }) {
  if (!photo) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 px-4 py-8">
      <button
        aria-label="Close photo viewer"
        className="absolute inset-0"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-full w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="section-label">Incident photo</div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close photo
          </button>
        </div>
        <img
          alt={photo.name}
          className="max-h-[80vh] w-full rounded-[28px] object-contain"
          src={photo.url}
        />
      </div>
    </div>
  );
}

function CameraCaptureDialog({ open, onCapture, onClose }) {
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!open) {
      setCameraError('');
      setCameraReady(false);
      setCapturing(false);
      return undefined;
    }

    let active = true;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Live camera capture is not supported in this browser. Use Upload photo instead.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' }
          }
        });

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          const playPromise = videoRef.current.play();
          if (playPromise?.catch) {
            playPromise.catch(() => {});
          }
        }
        setCameraError('');
      } catch {
        setCameraError('Camera access is blocked or unavailable. Allow camera permission and try again.');
      }
    }

    startCamera();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [open]);

  async function handleCapture() {
    if (!videoRef.current || !videoRef.current.videoWidth || !videoRef.current.videoHeight) {
      setCameraError('Camera is still starting. Wait a moment and try again.');
      return;
    }

    setCapturing(true);
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const context = canvas.getContext('2d');

    if (!context) {
      setCameraError('Camera capture could not be completed in this browser.');
      setCapturing(false);
      return;
    }

    context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });

    if (!blob) {
      setCameraError('A photo could not be generated from the camera feed.');
      setCapturing(false);
      return;
    }

    try {
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      const photo = await normalizeIncidentPhoto(file);
      onCapture(photo);
      setCameraError('');
      onClose();
    } catch (error) {
      setCameraError(error.message || 'A photo could not be prepared for upload.');
    } finally {
      setCapturing(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 px-4 py-8">
      <button
        aria-label="Close camera"
        className="absolute inset-0"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex w-full max-w-3xl flex-col gap-4 rounded-[30px] border border-white/10 bg-slate-950/95 p-4 shadow-[0_30px_90px_rgba(15,23,42,0.55)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="section-kicker">Live camera capture</div>
            <h3 className="font-display text-2xl text-white">Frame the incident and take a photo</h3>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-white/10 bg-slate-900">
          <video
            ref={videoRef}
            autoPlay
            className="aspect-[4/3] w-full bg-slate-950 object-cover"
            muted
            onCanPlay={() => setCameraReady(true)}
            playsInline
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
          <div className="text-sm text-slate-300">
            {cameraError
              ? cameraError
              : cameraReady
                ? 'Camera is live. Capture a fresh photo for this incident.'
                : 'Requesting camera access and starting the live preview.'}
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="ghost-button" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={!cameraReady || Boolean(cameraError) || capturing}
              onClick={handleCapture}
              type="button"
            >
              <Camera aria-hidden="true" className="h-4 w-4" />
              {capturing ? 'Capturing' : 'Take photo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncidentDrawer({
  incident,
  loading,
  user,
  onClose,
  onCommentCreate,
  onCommentDelete,
  onConfirm,
  onDispute,
  onAuthorityAction
}) {
  if (!incident && !loading) {
    return null;
  }

  return (
    <div className={`drawer-shell ${incident || loading ? 'drawer-shell-open' : ''}`}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer-panel">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <div className="section-kicker">Incident detail</div>
            <h3 className="font-display text-3xl text-white">
              {incident?.title || 'Loading incident'}
            </h3>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <IncidentDetailContent
          incident={incident}
          layout="drawer"
          loading={loading}
          user={user}
          onCommentCreate={onCommentCreate}
          onCommentDelete={onCommentDelete}
          onConfirm={onConfirm}
          onDispute={onDispute}
          onAuthorityAction={onAuthorityAction}
        />
      </aside>
    </div>
  );
}

function AuthExperience({ children, currentUser, flash, onContinue, onSignOut }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--canvas)] text-slate-950">
      <div className="app-grid pointer-events-none absolute inset-0 opacity-35" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[42rem] bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.12),transparent_24%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-12 pt-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="brand-mark">
              <RadioTower aria-hidden="true" className="h-5 w-5" />
            </Link>
            <div>
              <p className="font-display text-xl tracking-[0.08em] text-slate-950 sm:tracking-[0.12em]">
                PostAlert
              </p>
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Secure account access
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/65 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-800 backdrop-blur transition hover:bg-white"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
              Back home
            </Link>
            {currentUser ? (
              <>
                <button
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-slate-900"
                  onClick={onContinue}
                  type="button"
                >
                  Continue to platform
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/65 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-800 backdrop-blur transition hover:bg-white"
                  onClick={onSignOut}
                  type="button"
                >
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </header>

        {flash ? <FlashBanner flash={flash} /> : null}

        <section className="grid flex-1 gap-8 py-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:py-14">
          <div className="space-y-6">
            <div className="space-y-5">
              <div className="text-xs font-semibold uppercase tracking-[0.34em] text-slate-500">
                Secure entry to the live network
              </div>
              <h1 className="font-display text-[clamp(3.6rem,8vw,6.7rem)] leading-[0.88] tracking-[-0.08em] text-slate-950">
                Enter the
                <span className="block">incident</span>
                <span className="block text-amber-500">response loop.</span>
              </h1>
              <p className="max-w-xl text-lg leading-9 text-slate-600">
                Create a citizen account to report and verify incidents, or use a verified authority profile to manage response actions and operational visibility.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <AuthFeatureCard
                caption="Citizens can report incidents, attach evidence, and help verify what is real."
                icon={TriangleAlert}
                title="Citizen reporting"
              />
              <AuthFeatureCard
                caption="Verified authority users can review, respond, resolve, and coordinate faster."
                icon={ShieldCheck}
                title="Authority tools"
              />
              <AuthFeatureCard
                caption="Offline queueing and live map sync keep reporting useful in unstable conditions."
                icon={Clock3}
                title="Field ready"
              />
            </div>

            <div className="rounded-[32px] border border-slate-900/10 bg-white/68 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-2xl bg-slate-950 p-3 text-amber-300">
                  <MapPinned aria-hidden="true" className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    What happens after access
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">
                    You move into the live feed, reporting flow, trends view, and protected profile tools.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[40px] border border-white/12 bg-[linear-gradient(165deg,#111826_0%,#172233_52%,#1f2a3d_100%)] p-4 shadow-[0_36px_90px_rgba(9,16,34,0.34)] sm:p-6">
            {currentUser ? (
              <div className="mb-5 rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-4 text-emerald-100">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200/80">
                      Session live
                    </div>
                    <div className="mt-2 text-lg font-semibold text-white">
                      Signed in as {currentUser.name}
                    </div>
                  </div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/12 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-emerald-100">
                    {currentUser.role.replaceAll('_', ' ')}
                  </span>
                </div>
              </div>
            ) : null}

            {children}
          </div>
        </section>
      </main>
    </div>
  );
}

function AuthFeatureCard({ caption, icon: Icon, title }) {
  return (
    <div className="rounded-[28px] border border-slate-900/10 bg-white/68 p-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mb-6 inline-flex rounded-2xl bg-slate-950 p-3 text-amber-300">
        <Icon aria-hidden="true" className="h-5 w-5" />
      </div>
      <div className="text-sm font-semibold text-slate-950">{title}</div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{caption}</p>
    </div>
  );
}

function FieldErrorNotice({ message }) {
  return (
    <div role="alert" className="field-error-note">
      {message}
    </div>
  );
}

function PasswordField({
  autoComplete = 'current-password',
  error = '',
  label = 'Password',
  minLength = 8,
  onChange,
  onClearError,
  required = false,
  value
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="space-y-2">
      {error ? <FieldErrorNotice message={error} /> : null}
      <span className="section-label">{label}</span>
      <div className="password-field">
        <input
          autoComplete={autoComplete}
          className={`field ${error ? 'field-error' : ''}`}
          minLength={minLength}
          onChange={(event) => {
            onChange(event);
            onClearError?.();
          }}
          required={required}
          type={visible ? 'text' : 'password'}
          value={value}
        />
        <button
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
          <span>{visible ? 'Hide' : 'Show'}</span>
        </button>
      </div>
    </label>
  );
}

function AuthScreen({
  confirmation,
  errors = {},
  initialMode = 'login',
  onClearError,
  onClearErrors,
  onContinue,
  onRequestReset,
  onResetPassword,
  onSubmit,
  resetPreview
}) {
  const [mode, setMode] = useState(initialMode);
  const [resetOpen, setResetOpen] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    parish: 'Kingston',
    organizationName: '',
    badgeNumber: ''
  });
  const [resetForm, setResetForm] = useState({
    email: '',
    token: '',
    password: ''
  });

  const formTitle = {
    login: 'Sign in to PostAlert',
    register: 'Create a citizen account',
    authority: 'Register as an authority user'
  };
  const formCopy = {
    login: 'Access your secure reporting workspace and continue into the live incident platform.',
    register: 'Create a citizen profile to report incidents, add evidence, and follow updates in real time.',
    authority: 'Register an authority account to unlock operational tools after administrator approval.'
  };
  const modePill = {
    login: 'Returning user',
    register: 'Citizen access',
    authority: 'Authority access'
  };

  useEffect(() => {
    setMode(normalizeAuthMode(initialMode));
  }, [initialMode]);

  useEffect(() => {
    if (!resetPreview) {
      return;
    }
    setResetOpen(true);
    setResetForm((current) => ({
      ...current,
      email: resetPreview.email || current.email,
      token: resetPreview.token || current.token
    }));
  }, [resetPreview]);

  function selectMode(nextMode) {
    setMode(nextMode);
    onClearErrors?.();
  }

  function updateFormField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === 'email' || field === 'password') {
      onClearError?.(field);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-[34px] border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="section-kicker">Secure platform access</div>
            <h2 className="font-display text-4xl text-white">{formTitle[mode]}</h2>
            <p className="max-w-2xl text-sm leading-7 text-slate-300">{formCopy[mode]}</p>
          </div>
          <div className="rounded-full border border-white/10 bg-slate-950/35 px-4 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200">
            {modePill[mode]}
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <button
            className={`toggle-button ${mode === 'login' ? 'toggle-button-active' : ''}`}
            onClick={() => selectMode('login')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={`toggle-button ${mode === 'register' ? 'toggle-button-active' : ''}`}
            onClick={() => selectMode('register')}
            type="button"
          >
            Citizen
          </button>
          <button
            className={`toggle-button ${mode === 'authority' ? 'toggle-button-active' : ''}`}
            onClick={() => selectMode('authority')}
            type="button"
          >
            Authority
          </button>
        </div>
      </div>

      {confirmation ? (
        <div className="surface-card space-y-5">
          <div className="inline-flex rounded-2xl border border-emerald-400/25 bg-emerald-500/15 p-3 text-emerald-200">
            <CheckCircle2 aria-hidden="true" className="h-6 w-6" />
          </div>
          <div className="space-y-3">
            <div className="section-kicker">Account ready</div>
            <h3 className="font-display text-3xl text-white">{confirmation.title}</h3>
            <p className="text-sm leading-7 text-slate-300">{confirmation.message}</p>
          </div>
          <div className="rounded-[28px] border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            Signed in as {confirmation.email}
          </div>
          <button className="primary-button w-full" onClick={onContinue} type="button">
            Continue to platform
          </button>
        </div>
      ) : (
        <form
          className="surface-card space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(mode, form);
          }}
        >
          <label className="space-y-2">
            {errors.email ? <FieldErrorNotice message={errors.email} /> : null}
            <span className="section-label">Email</span>
            <input
              autoComplete="email"
              className={`field ${errors.email ? 'field-error' : ''}`}
              spellCheck={false}
              type="email"
              value={form.email}
              onChange={(event) => updateFormField('email', event.target.value)}
              required
            />
          </label>
          <PasswordField
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            error={errors.password}
            minLength={8}
            onChange={(event) => updateFormField('password', event.target.value)}
            required
            value={form.password}
          />
          {mode !== 'login' ? (
            <>
              <label className="space-y-2">
                <span className="section-label">Full name</span>
                <input
                  className="field"
                  value={form.name}
                  onChange={(event) => updateFormField('name', event.target.value)}
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="section-label">Parish</span>
                <select
                  className="field"
                  value={form.parish}
                  onChange={(event) => updateFormField('parish', event.target.value)}
                >
                  {PARISHES.map((parish) => (
                    <option key={parish} value={parish}>
                      {parish}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {mode === 'authority' ? (
            <>
              <label className="space-y-2">
                <span className="section-label">Organization</span>
                <input
                  className="field"
                  value={form.organizationName}
                  onChange={(event) => updateFormField('organizationName', event.target.value)}
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="section-label">Badge or ID number</span>
                <input
                  className="field"
                  value={form.badgeNumber}
                  onChange={(event) => updateFormField('badgeNumber', event.target.value)}
                  required
                />
              </label>
              <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
                Authority accounts are created in read-only mode until an administrator approves verification.
              </p>
            </>
          ) : null}
          <button className="primary-button w-full" type="submit">
            {mode === 'login' ? 'Access platform' : 'Create access'}
          </button>
          {mode === 'login' ? (
            <div className="space-y-4 rounded-[28px] border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="section-label">Password reset</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Request a reset token and complete the password update from this screen.
                  </p>
                </div>
                <button
                  className="ghost-button"
                  onClick={() => setResetOpen((current) => !current)}
                  type="button"
                >
                  {resetOpen ? 'Hide reset form' : 'Forgot password'}
                </button>
              </div>

              {resetOpen ? (
                <div className="space-y-4">
                  <label className="space-y-2">
                    <span className="section-label">Account email</span>
                    <input
                      autoComplete="email"
                      className="field"
                      spellCheck={false}
                      type="email"
                      value={resetForm.email}
                      onChange={(event) =>
                        setResetForm((current) => ({ ...current, email: event.target.value }))
                      }
                    />
                  </label>
                  <button
                    className="ghost-button w-full"
                    disabled={!resetForm.email}
                    onClick={() => onRequestReset(resetForm.email)}
                    type="button"
                  >
                    Generate reset token
                  </button>

                  {resetPreview?.token ? (
                    <div className="rounded-[24px] border border-amber-500/30 bg-amber-500/12 p-4 text-sm text-amber-100">
                      <div className="font-semibold text-white">Local development reset token</div>
                      <div className="mt-2 break-all font-mono text-xs text-amber-100">
                        {resetPreview.token}
                      </div>
                      <div className="mt-2 text-xs uppercase tracking-[0.16em] text-amber-200/80">
                        Expires {formatDateTime(resetPreview.expiresAt)}
                      </div>
                    </div>
                  ) : null}

                  <label className="space-y-2">
                    <span className="section-label">Reset token</span>
                    <input
                      className="field"
                      value={resetForm.token}
                      onChange={(event) =>
                        setResetForm((current) => ({ ...current, token: event.target.value }))
                      }
                    />
                  </label>
                  <PasswordField
                    autoComplete="new-password"
                    label="New password"
                    minLength={8}
                    onChange={(event) =>
                      setResetForm((current) => ({ ...current, password: event.target.value }))
                    }
                    value={resetForm.password}
                  />
                  <button
                    className="primary-button w-full"
                    disabled={!resetForm.token || resetForm.password.length < 8}
                    onClick={async () => {
                      const success = await onResetPassword(resetForm.token, resetForm.password);
                      if (!success) {
                        return;
                      }
                      setResetForm((current) => ({
                        ...current,
                        token: '',
                        password: ''
                      }));
                      setMode('login');
                      setResetOpen(false);
                    }}
                    type="button"
                  >
                    Update password
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      )}
    </section>
  );
}

function ReportWizard({ canPost, onSubmit, user }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const galleryInputRef = useRef(null);
  const [form, setForm] = useState({
    category: 'Crime',
    subcategory: CATEGORY_SUBCATEGORIES.Crime[0],
    description: '',
    latitude: user?.lastKnownLocation?.lat || 17.9712,
    longitude: user?.lastKnownLocation?.lng || -76.7928,
    address: `${user?.parish || 'Kingston'}, Jamaica`,
    severity: 'medium',
    anonymous: false,
    photos: []
  });
  const manualParishFallback =
    PARISHES.find((parish) => form.address.includes(parish)) || user?.parish || 'Kingston';
  const photoLimitReached = form.photos.length >= INCIDENT_PHOTO_UPLOAD.maxCount;

  function appendPhotos(nextPhotos) {
    if (!nextPhotos.length) {
      return;
    }

    let limitReached = false;
    let payloadTooLarge = false;
    setForm((current) => {
      const remainingSlots = Math.max(0, INCIDENT_PHOTO_UPLOAD.maxCount - current.photos.length);
      if (!remainingSlots) {
        limitReached = true;
        return current;
      }

      const photosToAdd = nextPhotos.slice(0, remainingSlots);
      if (photosToAdd.length < nextPhotos.length) {
        limitReached = true;
      }

      const candidatePhotos = [...current.photos, ...photosToAdd];
      const totalBytes = candidatePhotos.reduce(
        (sum, photo) => sum + estimateDataUrlBytes(photo.dataUrl),
        0
      );
      if (totalBytes > INCIDENT_PHOTO_UPLOAD.maxTotalBytes) {
        payloadTooLarge = true;
        return current;
      }

      return {
        ...current,
        photos: candidatePhotos
      };
    });

    if (payloadTooLarge) {
      setError('Photos are still too large together. Remove one or choose smaller images.');
      return;
    }

    setError(
      limitReached
        ? `You can upload up to ${INCIDENT_PHOTO_UPLOAD.maxCount} photos per report.`
        : ''
    );
  }

  async function handleFiles(fileList) {
    const selectedFiles = Array.from(fileList || []);
    if (!selectedFiles.length) {
      return;
    }
    const files = selectedFiles.slice(0, INCIDENT_PHOTO_UPLOAD.maxCount);
    const invalid = files.find(
      (file) => !INCIDENT_PHOTO_UPLOAD.allowedTypes.includes(file.type)
    );
    if (invalid) {
      setError('Only JPEG or PNG files are allowed.');
      return;
    }
    try {
      setProcessingPhotos(true);
      const photos = await Promise.all(files.map((file) => normalizeIncidentPhoto(file)));
      appendPhotos(photos);
    } catch (processingError) {
      setError(processingError.message || 'A photo could not be prepared for upload.');
    } finally {
      setProcessingPhotos(false);
    }
  }

  function handlePhotoInputChange(event) {
    handleFiles(event.target.files);
    event.target.value = '';
  }

  function handleCameraCapture(photo) {
    appendPhotos([photo]);
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: Number(position.coords.latitude.toFixed(5)),
          longitude: Number(position.coords.longitude.toFixed(5))
        }));
      },
      () => {
        setError('Location access denied. Use manual coordinates or tap the map to place a pin.');
      }
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!canPost) {
      setError('Your account currently has read-only access and cannot submit incidents.');
      return;
    }
    if (form.description.length < 10 || form.description.length > 500) {
      setError('Description must be between 10 and 500 characters.');
      return;
    }
    if (!withinJamaica(form.latitude, form.longitude)) {
      setError('Location must be within Jamaica.');
      return;
    }
    if (processingPhotos) {
      setError('Please wait while photos finish preparing for upload.');
      return;
    }
    setSubmitting(true);
    await onSubmit(form);
    setSubmitting(false);
  }

  return (
    <form className="surface-card space-y-6" onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="section-kicker">Incident reporting wizard</div>
          <h2 className="font-display text-3xl text-white">Step {step} of 4</h2>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((index) => (
            <button key={index} type="button" className={`step-chip ${step === index ? 'step-chip-active' : ''}`} onClick={() => setStep(index)}>
              {index}
            </button>
          ))}
        </div>
      </div>

      {step === 1 ? (
        <div className="space-y-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {Object.entries(CATEGORY_META).map(([category, meta]) => {
              const Icon = meta.icon;
              return (
                <button key={category} type="button" className={`category-tile ${form.category === category ? 'category-tile-active' : ''}`} onClick={() => setForm((current) => ({ ...current, category, subcategory: CATEGORY_SUBCATEGORIES[category][0] }))}>
                  <div className={`icon-shell ${meta.surface} ${meta.accent}`}>
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold text-white">{category}</div>
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="section-label">Subcategory</span>
              <select className="field" value={form.subcategory} onChange={(event) => setForm((current) => ({ ...current, subcategory: event.target.value }))}>
                {CATEGORY_SUBCATEGORIES[form.category].map((subcategory) => (
                  <option key={subcategory} value={subcategory}>{subcategory}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          <div className="surface-muted space-y-4">
            <div>
              <div className="section-label">Search, pin, and confirm</div>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                Search for an address, use your current location, or drag the pin until the incident location is exact.
              </p>
            </div>

            {MAPBOX_ENABLED ? (
              <MapboxLocationPicker
                onChange={(nextLocation) =>
                  setForm((current) => ({
                    ...current,
                    latitude: nextLocation.latitude,
                    longitude: nextLocation.longitude,
                    address: nextLocation.address
                  }))
                }
                value={form}
              />
            ) : (
              <>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="primary-button" onClick={requestLocation}>
                    Use current GPS location
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        latitude: 17.9712,
                        longitude: -76.7928,
                        address: 'Kingston, Jamaica'
                      }))
                    }
                  >
                    Reset to Kingston
                  </button>
                </div>
                <IncidentMap
                  editable
                  incidents={[]}
                  onPick={(coords) =>
                    setForm((current) => ({
                      ...current,
                      latitude: coords.latitude,
                      longitude: coords.longitude
                    }))
                  }
                  value={form}
                />
              </>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2">
              <span className="section-label">Manual parish fallback</span>
              <select
                className="field"
                value={manualParishFallback}
                onChange={(event) => {
                  const center = PARISH_CENTERS[event.target.value];
                  setForm((current) => ({
                    ...current,
                    latitude: center.lat,
                    longitude: center.lng,
                    address: `${event.target.value}, Jamaica`
                  }));
                }}
              >
                {PARISHES.map((parish) => (
                  <option key={parish} value={parish}>
                    {parish}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="section-label">Latitude</span>
              <input className="field" type="number" step="0.00001" value={form.latitude} onChange={(event) => setForm((current) => ({ ...current, latitude: Number(event.target.value) }))} />
            </label>
            <label className="space-y-2">
              <span className="section-label">Longitude</span>
              <input className="field" type="number" step="0.00001" value={form.longitude} onChange={(event) => setForm((current) => ({ ...current, longitude: Number(event.target.value) }))} />
            </label>
            <label className="space-y-2">
              <span className="section-label">Address or landmark</span>
              <input className="field" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
            </label>
          </div>
          <div className={`rounded-2xl border px-4 py-3 text-sm ${withinJamaica(form.latitude, form.longitude) ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-500/30 bg-rose-500/10 text-rose-100'}`}>
            {withinJamaica(form.latitude, form.longitude) ? 'Selected coordinates are within Jamaica.' : 'Selected coordinates are outside Jamaica. Move the pin or enter a valid location.'}
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
          <div className="space-y-4">
            <label className="space-y-2">
              <span className="section-label">Description</span>
              <textarea
                className="field min-h-36"
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value.slice(0, 500) }))
                }
                placeholder="Describe what happened, current risk, and anything responders should know."
              />
              <div className="text-right text-xs text-slate-400">{form.description.length} / 500 characters</div>
            </label>
            <label className="space-y-2">
              <span className="section-label">
                Upload up to {INCIDENT_PHOTO_UPLOAD.maxCount} photos
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className="ghost-button justify-center disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={photoLimitReached || processingPhotos}
                  onClick={() => galleryInputRef.current?.click()}
                >
                  <Upload aria-hidden="true" className="h-4 w-4" />
                  {processingPhotos ? 'Preparing photo' : 'Upload photo'}
                </button>
                <button
                  type="button"
                  className="ghost-button justify-center disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={photoLimitReached || processingPhotos}
                  onClick={() => setCameraOpen(true)}
                >
                  <Camera aria-hidden="true" className="h-4 w-4" />
                  Use camera
                </button>
              </div>
              <input
                ref={galleryInputRef}
                className="hidden"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                onChange={handlePhotoInputChange}
              />
              <div className="text-xs text-slate-400">
                JPEG or PNG only. Photos are optimized for upload and should stay around {Math.round(INCIDENT_PHOTO_UPLOAD.maxBytes / 1024)} KB each.
              </div>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {form.photos.map((photo, index) => (
                <img key={`${photo.name}-${index}`} src={photo.dataUrl} alt={photo.name} className="h-28 w-full rounded-[24px] object-cover" />
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="section-label">Severity level</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(SEVERITY_META).map(([severity, meta]) => (
                <button key={severity} type="button" className={`severity-tile ${form.severity === severity ? 'severity-tile-active' : ''}`} onClick={() => setForm((current) => ({ ...current, severity }))}>
                  <div className={`severity-pill ${meta.chip}`}>{meta.label}</div>
                  <div className="text-sm text-slate-300">{severity === 'critical' ? 'Immediate life-threatening risk' : 'Community alert priority'}</div>
                </button>
              ))}
            </div>
            <label className="flex items-end gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
              <input
                type="checkbox"
                checked={form.anonymous}
                onChange={(event) =>
                  setForm((current) => ({ ...current, anonymous: event.target.checked }))
                }
              />
              <span className="text-sm text-slate-300">Report anonymously in the public detail view</span>
            </label>
          </div>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <SummaryCard label="Category" value={`${form.category} · ${form.subcategory}`} />
            <SummaryCard label="Severity" value={SEVERITY_META[form.severity].label} />
            <SummaryCard
              label="Location"
              value={`${form.address} • ${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)}`}
            />
            <SummaryCard label="Photos" value={`${form.photos.length}`} />
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-300">{form.description}</div>
        </div>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

      <CameraCaptureDialog
        onCapture={handleCameraCapture}
        onClose={() => setCameraOpen(false)}
        open={cameraOpen}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="ghost-button" onClick={() => setStep((current) => Math.max(current - 1, 1))}>
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Back
        </button>
        <div className="flex gap-3">
          {step < 4 ? (
            <button type="button" className="primary-button" onClick={() => setStep((current) => Math.min(current + 1, 4))}>
              Continue
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : (
            <button type="submit" className="primary-button" disabled={submitting || processingPhotos}>
              {processingPhotos ? 'Preparing photos…' : submitting ? 'Submitting…' : 'Submit incident'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function AuthorityScreen({ dashboard, filters, pendingAuthorities, user, onAction, onFiltersChange, onApprove }) {
  const [notesByIncident, setNotesByIncident] = useState({});
  const [pendingByIncident, setPendingByIncident] = useState({});

  async function submitAction(incidentId, action) {
    setPendingByIncident((current) => ({ ...current, [incidentId]: action }));
    const success = await onAction(incidentId, action, notesByIncident[incidentId] || '');
    if (success) {
      setNotesByIncident((current) => ({
        ...current,
        [incidentId]: ''
      }));
    }
    setPendingByIncident((current) => {
      const next = { ...current };
      delete next[incidentId];
      return next;
    });
  }

  if (!dashboard) {
    return <div className="surface-card text-sm text-slate-400">Loading authority dashboard…</div>;
  }

  return (
    <section className="space-y-6">
      <div className="surface-card">
        <div className="section-kicker">Authority operations</div>
        <h2 className="font-display text-3xl text-white">{dashboard.parish} command view</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="section-label">{dashboard.isAdmin ? 'Parish selector' : 'Parish filter'}</span>
            <select
              className="field"
              value={filters.parish}
              onChange={(event) =>
                onFiltersChange((current) => ({ ...current, parish: event.target.value }))
              }
            >
              <option value="">All parishes</option>
              {PARISHES.map((parish) => (
                <option key={parish} value={parish}>
                  {parish}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="section-label">Status filter</span>
            <select
              className="field"
              value={filters.status}
              onChange={(event) =>
                onFiltersChange((current) => ({ ...current, status: event.target.value }))
              }
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="responding">Responding</option>
              <option value="authority_verified">Authority verified</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Total active" value={String(dashboard.stats.totalActive)} />
          <SummaryCard label="Citizen signups" value={String(dashboard.stats.citizenSignups || 0)} />
          <SummaryCard label="Highest category" value={Object.entries(dashboard.stats.byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None'} />
          <SummaryCard label="Highest severity" value={Object.entries(dashboard.stats.bySeverity).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None'} />
        </div>
        {dashboard.readOnly || user?.role === 'authority_pending' ? (
          <div className="mt-6 rounded-[28px] border border-amber-500/30 bg-amber-500/12 p-4 text-sm text-amber-100">
            Your authority account is still pending approval. You can review incidents, but official actions remain disabled until an administrator approves verification.
          </div>
        ) : null}
      </div>
      <div className="surface-card">
        <div className="section-label mb-4">Visible incidents</div>
        <div className="space-y-3">
          {dashboard.incidents.length ? dashboard.incidents.map((incident) => (
            <div key={incident.id} className={`rounded-[28px] border p-4 ${(incident.severity === 'high' || incident.severity === 'critical' || incident.credibility !== 'verified') ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CategoryBadge category={incident.category} />
                    <SeverityBadge severity={incident.severity} />
                    <StatusBadge status={incident.status} />
                  </div>
                  <div className="text-lg font-semibold text-white">{incident.title}</div>
                  <div className="text-sm text-slate-400">{formatAgo(incident.createdAt)} · {incident.confirmationCount} confirmations</div>
                </div>
                <div className="w-full space-y-3 lg:w-auto">
                  <AuthorityActionComposer
                    actionLabel="Record authority action"
                    buttonGridClassName="sm:grid-cols-2 lg:grid-cols-4"
                    incident={incident}
                    notes={notesByIncident[incident.id] || ''}
                    onAction={(action) => submitAction(incident.id, action)}
                    onNotesChange={(value) =>
                      setNotesByIncident((current) => ({
                        ...current,
                        [incident.id]: value
                      }))
                    }
                    pendingAction={pendingByIncident[incident.id] || ''}
                    readOnly={dashboard.readOnly}
                  />
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-[28px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
              No incidents match the current filters yet.
            </div>
          )}
        </div>
      </div>
      {pendingAuthorities.length ? (
        <div className="surface-card">
          <div className="section-label mb-4">Pending authority verification</div>
          <div className="space-y-3">
            {pendingAuthorities.map((authority) => (
              <div key={authority.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-white/5 p-4">
                <div>
                  <div className="font-semibold text-white">{authority.name}</div>
                  <div className="text-sm text-slate-400">{authority.organizationName} · {authority.badgeNumber}</div>
                </div>
                <button className="primary-button" onClick={() => onApprove(authority.id)}>
                  Approve authority
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TrendsScreen({
  trendsBundle,
  onChangeDateFrom,
  onChangeDateTo,
  onChangeParish,
  onChangePeriod
}) {
  const periodOptions = [
    { value: '24h', label: 'Past 24 hours', shortLabel: '24h' },
    { value: '7d', label: 'Past 7 days', shortLabel: '7d' },
    { value: '30d', label: 'Past 30 days', shortLabel: '30d' }
  ];
  const categories = Object.entries(trendsBundle.counts).sort((left, right) => right[1] - left[1]);
  const highestCount = Math.max(...categories.map(([, count]) => count), 1);
  const hotspotRanking = [...trendsBundle.heatmap].sort((left, right) => right.weight - left.weight);
  const highestHotspotWeight = Math.max(...hotspotRanking.map((point) => point.weight), 1);
  const topCategory = trendsBundle.top[0] || null;
  const leadHotspot = hotspotRanking[0] || null;
  const selectedPeriodLabel =
    periodOptions.find((entry) => entry.value === trendsBundle.period)?.label || 'Selected period';
  const activeRangeLabel =
    trendsBundle.dateFrom || trendsBundle.dateTo
      ? `${trendsBundle.dateFrom || 'Start'} -> ${trendsBundle.dateTo || 'Today'}`
      : selectedPeriodLabel;
  const dominantShare = topCategory
    ? Math.round((topCategory.count / Math.max(trendsBundle.total, 1)) * 100)
    : 0;
  const overviewCopy = trendsBundle.total
    ? `${trendsBundle.total} incidents are shaping this view ${trendsBundle.parish ? `for ${trendsBundle.parish}` : 'across Jamaica'}. ${
        topCategory
          ? `${topCategory.category} leads the mix at ${dominantShare}% of reports.`
          : 'Category leadership will appear as more reports are recorded.'
      } ${
        leadHotspot
          ? `${leadHotspot.parish} is carrying the strongest hotspot signal right now.`
          : 'Hotspot ranking will sharpen as more incidents enter the selected window.'
      }`
    : 'No incidents match the current filters yet. Expand the parish or date range to widen the trend signal.';
  const insightChips = [
    trendsBundle.parish ? `${trendsBundle.parish} focus` : 'All-parish view',
    activeRangeLabel,
    trendsBundle.total >= 3 ? 'Confidence threshold met' : 'Confidence still building'
  ];

  return (
    <section className="space-y-6">
      <div className="hero-panel xl:grid-cols-[1.15fr_0.85fr] xl:items-start">
        <div className="space-y-5">
          <div>
            <div className="section-kicker">Historical trends</div>
            <h2 className="font-display text-3xl text-white md:text-4xl">Safety patterns and hot spots</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">{overviewCopy}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {insightChips.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-200"
              >
                {chip}
              </span>
            ))}
          </div>
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-4">
            <div className="section-label">Reading note</div>
            <p className="mt-3 text-sm leading-7 text-slate-300">
              Resolved incidents remain in this analysis so the trends page can preserve historical hotspot pressure instead of only showing the live board.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <TrendSignalCard
            caption={selectedPeriodLabel}
            icon={RadioTower}
            label="Selected window"
            tone="amber"
            value={String(trendsBundle.total)}
          />
          <TrendSignalCard
            caption={topCategory ? `${dominantShare}% of current reports` : 'Awaiting stronger category signal'}
            icon={TriangleAlert}
            label="Dominant category"
            tone="rose"
            value={topCategory?.category || 'No leader yet'}
          />
          <TrendSignalCard
            caption={leadHotspot ? `Weighted intensity ${leadHotspot.weight}` : 'No hotspot leader yet'}
            icon={MapPinned}
            label="Strongest hotspot"
            tone="sky"
            value={leadHotspot?.parish || 'Insufficient data'}
          />
        </div>
      </div>

      <div className="surface-card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="section-label">Filter deck</div>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">
              Switch the time window, narrow to a parish, or pin a custom date range to inspect how pressure shifts across Jamaica.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                className={`chip-button !w-auto px-4 ${trendsBundle.period === option.value ? 'chip-button-active' : ''}`}
                onClick={() => onChangePeriod(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_repeat(3,minmax(0,0.8fr))]">
          <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Active reading</div>
            <div className="mt-2 text-sm text-white">{activeRangeLabel}</div>
            <div className="mt-1 text-sm text-slate-400">
              {trendsBundle.parish ? `${trendsBundle.parish} parish filter applied.` : 'Scanning all parishes in the current dataset.'}
            </div>
          </div>
          <label className="space-y-2">
            <span className="section-label">Parish</span>
            <select className="field" value={trendsBundle.parish} onChange={(event) => onChangeParish(event.target.value)}>
              <option value="">All parishes</option>
              {PARISHES.map((parish) => (
                <option key={parish} value={parish}>{parish}</option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="section-label">Date from</span>
            <input
              className="field"
              type="date"
              value={trendsBundle.dateFrom}
              onChange={(event) => onChangeDateFrom(event.target.value)}
            />
          </label>
          <label className="space-y-2">
            <span className="section-label">Date to</span>
            <input
              className="field"
              type="date"
              value={trendsBundle.dateTo}
              onChange={(event) => onChangeDateTo(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {periodOptions.map((option) => (
          <TrendWindowCard
            key={option.value}
            active={trendsBundle.period === option.value}
            caption={option.value === '24h' ? 'Immediate signal watch' : option.value === '7d' ? 'Operational weekly rhythm' : 'Longer-running pressure line'}
            label={option.label}
            value={String(trendsBundle.summary[option.value])}
          />
        ))}
      </div>

      {trendsBundle.total < 3 ? (
        <div className="rounded-[28px] border border-amber-400/20 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
          Minimum data threshold not met yet. Add at least three incidents in the selected period for stronger trend insight.
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="surface-card space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="section-label">Category pressure</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  Ranked incident volume for the active window, showing where report intensity is concentrating first.
                </p>
              </div>
              {topCategory ? (
                <div className="rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100">
                  {dominantShare}% concentration
                </div>
              ) : null}
            </div>

            {categories.length ? (
              <div className="space-y-4">
                {categories.map(([category, count]) => (
                  <div key={category} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CategoryBadge category={category} />
                      <div className="text-right">
                        <div className="text-lg font-semibold text-white">{count}</div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">
                          {Math.round((count / Math.max(trendsBundle.total, 1)) * 100)}% of reports
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 h-3 rounded-full bg-white/5">
                      <div
                        className="h-3 rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-rose-400"
                        style={{ width: `${(count / highestCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                No category counts are available for the current filters yet.
              </div>
            )}
          </div>

          <div className="surface-card">
            <div className="section-label mb-4">Category stack</div>
            {trendsBundle.top.length ? (
              <div className="space-y-3">
                {trendsBundle.top.map((entry, index) => (
                  <div key={entry.category} className="flex items-center justify-between rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-200">
                        {index + 1}
                      </span>
                      <div>
                        <div className="font-semibold text-white">{entry.category}</div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Top reported category</div>
                      </div>
                    </div>
                    <div className="text-sm text-slate-300">{entry.count} reports</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                The ranking will appear once incidents are available in the selected window.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="surface-card space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="section-label">Hotspot radar</div>
                <p className="mt-2 text-sm leading-7 text-slate-300">
                  Severity-weighted parish pressure showing where incident concentration is persisting the most.
                </p>
              </div>
              {leadHotspot ? (
                <div className="rounded-full border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-sky-100">
                  Lead hotspot: {leadHotspot.parish}
                </div>
              ) : null}
            </div>

            <HeatGrid points={trendsBundle.heatmap} />

            <div className="flex items-center justify-between text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
              <span>Lower signal</span>
              <span>Higher signal</span>
            </div>
          </div>

          <div className="surface-card">
            <div className="section-label mb-4">Hotspot leaderboard</div>
            {hotspotRanking.length ? (
              <div className="space-y-3">
                {hotspotRanking.slice(0, 5).map((point, index) => (
                  <div key={point.parish} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{index + 1}. {point.parish}</div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Weighted hotspot signal</div>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">
                        {point.weight}
                      </div>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/5">
                      <div
                        className="h-2 rounded-full bg-gradient-to-r from-sky-300 via-amber-300 to-rose-400"
                        style={{ width: `${(point.weight / highestHotspotWeight) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[24px] border border-dashed border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-400">
                Hotspot ranking will appear once incidents are available in the selected window.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function TrendSignalCard({ caption, icon: Icon, label, tone = 'amber', value }) {
  const tones = {
    amber: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
    rose: 'border-rose-400/20 bg-rose-400/10 text-rose-100',
    sky: 'border-sky-400/20 bg-sky-400/10 text-sky-100'
  };

  return (
    <div className={`rounded-[28px] border p-4 ${tones[tone] || tones.amber}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] opacity-80">{label}</div>
          <div className="mt-3 text-xl font-semibold text-white">{value}</div>
        </div>
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-slate-950/30">
          <Icon aria-hidden="true" className="h-5 w-5 text-white" />
        </span>
      </div>
      <div className="mt-4 text-sm leading-6 text-slate-200/90">{caption}</div>
    </div>
  );
}

function TrendWindowCard({ active, caption, label, value }) {
  return (
    <div
      className={`rounded-[28px] border p-4 transition ${
        active
          ? 'border-amber-400/45 bg-[linear-gradient(160deg,rgba(38,26,8,0.98),rgba(17,24,38,0.96))] shadow-[0_20px_48px_rgba(120,78,10,0.26)]'
          : 'border-slate-800/20 bg-[linear-gradient(160deg,rgba(17,24,38,0.96),rgba(23,34,51,0.92))] shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={`text-xs uppercase tracking-[0.18em] ${active ? 'text-amber-200' : 'text-slate-300'}`}>{label}</div>
          <div className={`mt-3 text-2xl font-semibold ${active ? 'text-amber-50' : 'text-white'}`}>{value}</div>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-2 text-[0.68rem] font-semibold uppercase tracking-[0.18em] ${
            active
              ? 'bg-amber-300 text-slate-950 shadow-[0_10px_24px_rgba(245,158,11,0.3)]'
              : 'border border-white/12 bg-slate-950/35 text-slate-200'
          }`}
        >
          {active ? 'Live view' : 'Reference'}
        </span>
      </div>
      <div className={`mt-4 text-sm leading-6 ${active ? 'text-amber-100/90' : 'text-slate-200'}`}>{caption}</div>
    </div>
  );
}

function ProfileScreen({ bundle, activityBundle, onSave, onPreferencesSave, onAppeal }) {
  const [form, setForm] = useState({
    name: bundle?.user?.name || '',
    parish: bundle?.user?.parish || 'Kingston',
    latitude: bundle?.user?.lastKnownLocation?.lat || PARISH_CENTERS.Kingston.lat,
    longitude: bundle?.user?.lastKnownLocation?.lng || PARISH_CENTERS.Kingston.lng
  });
  const [prefs, setPrefs] = useState(bundle?.user?.notificationPrefs || DEFAULT_NOTIFICATION_PREFS);
  const [appeal, setAppeal] = useState({ strikeId: '', message: '' });

  useEffect(() => {
    setForm({
      name: bundle?.user?.name || '',
      parish: bundle?.user?.parish || 'Kingston',
      latitude: bundle?.user?.lastKnownLocation?.lat || PARISH_CENTERS.Kingston.lat,
      longitude: bundle?.user?.lastKnownLocation?.lng || PARISH_CENTERS.Kingston.lng
    });
    setPrefs(bundle?.user?.notificationPrefs || DEFAULT_NOTIFICATION_PREFS);
  }, [bundle?.user?.id, bundle?.user?.name, bundle?.user?.parish, bundle?.user?.notificationPrefs]);

  if (!bundle || !activityBundle) {
    return <div className="surface-card text-sm text-slate-400">Loading profile…</div>;
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <div className="surface-card">
          <div className="section-kicker">Profile overview</div>
          <h2 className="font-display text-3xl text-white">{bundle.user.name}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <SummaryCard label="Email" value={bundle.user.email} />
            <SummaryCard label="Role" value={bundle.user.role.replaceAll('_', ' ')} />
            <SummaryCard label="Parish" value={bundle.user.parish} />
            <SummaryCard label="Reputation" value={String(bundle.user.reputationScore)} />
            <SummaryCard label="Member since" value={formatDateTime(bundle.user.createdAt)} />
            <SummaryCard label="Strike count" value={String(bundle.user.strikeCount)} />
          </div>
        </div>
        <div className="surface-card space-y-4">
          <div className="section-label">Edit profile</div>
          <label className="space-y-2">
            <span className="section-label">Name</span>
            <input className="field" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="space-y-2">
            <span className="section-label">Parish</span>
            <select className="field" value={form.parish} onChange={(event) => setForm((current) => ({ ...current, parish: event.target.value }))}>
              {PARISHES.map((parish) => (
                <option key={parish} value={parish}>{parish}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="section-label">Latitude</span>
              <input
                className="field"
                type="number"
                step="0.00001"
                value={form.latitude}
                onChange={(event) =>
                  setForm((current) => ({ ...current, latitude: Number(event.target.value) }))
                }
              />
            </label>
            <label className="space-y-2">
              <span className="section-label">Longitude</span>
              <input
                className="field"
                type="number"
                step="0.00001"
                value={form.longitude}
                onChange={(event) =>
                  setForm((current) => ({ ...current, longitude: Number(event.target.value) }))
                }
              />
            </label>
          </div>
          <button
            className="primary-button"
            onClick={() =>
              onSave({
                name: form.name,
                parish: form.parish,
                lastKnownLocation: {
                  lat: form.latitude,
                  lng: form.longitude
                }
              })
            }
          >
            Save profile
          </button>
        </div>
        <div className="surface-card space-y-4">
          <div className="section-label">Notification preferences</div>
          <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <span className="text-sm text-slate-300">Enable nearby incident notifications</span>
            <input type="checkbox" checked={prefs.enabled} onChange={(event) => setPrefs((current) => ({ ...current, enabled: event.target.checked }))} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="section-label">Severity threshold</span>
              <select className="field" value={prefs.minSeverity} onChange={(event) => setPrefs((current) => ({ ...current, minSeverity: event.target.value }))}>
                {Object.keys(SEVERITY_META).map((severity) => (
                  <option key={severity} value={severity}>{SEVERITY_META[severity].label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="section-label">Radius (km)</span>
              <input className="field" type="number" min="1" max="20" value={prefs.radiusKm} onChange={(event) => setPrefs((current) => ({ ...current, radiusKm: Number(event.target.value) }))} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="section-label">Quiet hours start</span>
              <input className="field" type="time" value={prefs.quietHoursStart} onChange={(event) => setPrefs((current) => ({ ...current, quietHoursStart: event.target.value }))} />
            </label>
            <label className="space-y-2">
              <span className="section-label">Quiet hours end</span>
              <input className="field" type="time" value={prefs.quietHoursEnd} onChange={(event) => setPrefs((current) => ({ ...current, quietHoursEnd: event.target.value }))} />
            </label>
          </div>
          <div className="space-y-3">
            <div className="section-label">Categories</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.keys(CATEGORY_META).map((category) => (
                <label
                  key={category}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={prefs.categories.includes(category)}
                    onChange={(event) =>
                      setPrefs((current) => ({
                        ...current,
                        categories: event.target.checked
                          ? [...current.categories, category]
                          : current.categories.filter((entry) => entry !== category)
                      }))
                    }
                  />
                  <span>{category}</span>
                </label>
              ))}
            </div>
          </div>
          <button className="primary-button" onClick={() => onPreferencesSave(prefs)}>Save notification settings</button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="surface-card">
          <div className="section-label mb-4">Reported incidents</div>
          <div className="space-y-3">
            {bundle.incidents.map((incident) => (
              <div key={incident.id} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-white">{incident.title}</span>
                  <StatusBadge status={incident.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card">
          <div className="section-label mb-4">Confirmations and disputes</div>
          <div className="space-y-3">
            {activityBundle.items.map((activity) => (
              <div key={activity.id} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="font-semibold text-white">{activity.incidentTitle}</div>
                <div className="text-sm text-slate-400">{activity.action} · {formatAgo(activity.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card space-y-4">
          <div className="section-label">Strikes and appeals</div>
          <div className="space-y-3">
            {bundle.strikes.length ? bundle.strikes.map((strike) => (
              <label key={strike.id} className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <input type="radio" name="strikeId" value={strike.id} checked={appeal.strikeId === strike.id} onChange={(event) => setAppeal((current) => ({ ...current, strikeId: event.target.value }))} />
                <div>
                  <div className="font-semibold text-white">{strike.reason}</div>
                  <div className="text-sm text-slate-400">{formatDateTime(strike.createdAt)}</div>
                  {bundle.appeals.find((entry) => entry.strikeId === strike.id) ? (
                    <div className="mt-2 text-xs uppercase tracking-[0.16em] text-amber-300">
                      Appeal status: {bundle.appeals.find((entry) => entry.strikeId === strike.id)?.status}
                    </div>
                  ) : null}
                </div>
              </label>
            )) : <div className="text-sm text-slate-400">No active strikes.</div>}
          </div>
          <textarea className="field min-h-24" placeholder="Submit a short appeal for the selected strike." value={appeal.message} onChange={(event) => setAppeal((current) => ({ ...current, message: event.target.value }))} />
          <button className="ghost-button" onClick={() => onAppeal(appeal)}>Submit appeal</button>
        </div>

        <div className="surface-card">
          <div className="section-label mb-4">Recent notifications</div>
          <div className="space-y-3">
            {bundle.notifications.length ? bundle.notifications.map((notification) => (
              <div key={notification.id} className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <div className="font-semibold text-white">{notification.title}</div>
                <div className="text-sm text-slate-300">{notification.body}</div>
                <div className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                  {formatAgo(notification.createdAt)}
                </div>
              </div>
            )) : <div className="text-sm text-slate-400">No notifications recorded yet.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProtectedMessage({ href, title }) {
  return (
    <div className="surface-card text-center">
      <h2 className="font-display text-3xl text-white">{title}</h2>
      <p className="mt-3 text-sm text-slate-300">Use the secure access flow to continue.</p>
      <div className="mt-6 flex justify-center">
        <Link href={href} className="primary-button">
          Continue
        </Link>
      </div>
    </div>
  );
}

function LoadingSurface({ message }) {
  return <div className="surface-card text-sm text-slate-400">{message}</div>;
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function InfoBlock({ label, children }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm text-white">{children}</div>
    </div>
  );
}

function CategoryBadge({ category }) {
  const Icon = CATEGORY_META[category]?.icon || FALLBACK_CATEGORY_ICON;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">
      <Icon aria-hidden="true" className={`h-4 w-4 ${CATEGORY_META[category]?.accent || 'text-white'}`} />
      {category}
    </span>
  );
}

function SeverityBadge({ severity }) {
  return <span className={`severity-pill ${SEVERITY_META[severity]?.chip}`}>{SEVERITY_META[severity]?.label || severity}</span>;
}

function StatusBadge({ status }) {
  return <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">{status.replaceAll('_', ' ')}</span>;
}

function CredibilityBadge({ credibility }) {
  const tones = {
    pending: 'border-white/10 bg-white/5 text-slate-200',
    verified: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200',
    flagged: 'border-rose-500/30 bg-rose-500/15 text-rose-100'
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-2 text-xs uppercase tracking-[0.18em] ${tones[credibility] || tones.pending}`}>
      {credibility}
    </span>
  );
}

function HeatGrid({ points }) {
  const cells = Array.from({ length: 24 }, (_, index) => {
    const latBand = index % 6;
    const lngBand = Math.floor(index / 6);
    return points
      .filter((point) => {
        const x = Math.floor(((point.longitude - MAP_BOUNDS.lngMin) / (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin)) * 4);
        const y = Math.floor(((MAP_BOUNDS.latMax - point.latitude) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin)) * 6);
        return x === lngBand && y === latBand;
      })
      .reduce((sum, point) => sum + point.weight, 0);
  });
  const max = Math.max(...cells, 1);

  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((value, index) => (
        <div key={index} className="aspect-[1.1/1] rounded-2xl border border-white/5" style={{ background: `rgba(245, 158, 11, ${0.12 + (value / max) * 0.72})` }} />
      ))}
    </div>
  );
}

function readFromStorage(key, fallback) {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeToStorage(key, value) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, JSON.stringify(value));
  }
}

function incidentDetailPath(incidentId) {
  return `/incidents/${incidentId}`;
}

function feedIncidentPath(searchParams, incidentId = '') {
  const nextSearchParams = new URLSearchParams(searchParams?.toString() || '');
  if (incidentId) {
    nextSearchParams.set('incident', incidentId);
  } else {
    nextSearchParams.delete('incident');
  }
  const query = nextSearchParams.toString();
  return query ? `/feed?${query}` : '/feed';
}

function normalizeAuthMode(value) {
  return ['login', 'register', 'authority'].includes(value) ? value : 'login';
}

function normalizeCallbackPath(value) {
  if (!value) {
    return '/feed';
  }

  if (value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/auth')) {
    return value;
  }

  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (path.startsWith('/auth')) {
      return '/feed';
    }
    return path.startsWith('/') ? path : '/feed';
  } catch {
    return '/feed';
  }
}

function getAuthFieldErrors(error) {
  if (!error?.code) {
    return null;
  }

  if ([4022, 4024, 4090, 4006].includes(error.code)) {
    return { email: error.message };
  }

  if ([4004, 4023, 4025].includes(error.code)) {
    return { password: error.message };
  }

  return null;
}

function openIncidentPage(incidentId, router) {
  router.push(incidentDetailPath(incidentId));
}

function openIncidentPreview(incidentId, router, searchParams) {
  router.push(feedIncidentPath(searchParams, incidentId), { scroll: false });
}

function closeIncidentPreview(router, searchParams) {
  router.replace(feedIncidentPath(searchParams), { scroll: false });
}

function broadcast(type, payload = {}) {
  if (typeof window !== 'undefined' && window.BroadcastChannel) {
    const channel = new BroadcastChannel(PLATFORM_BROADCAST_CHANNEL_NAME);
    channel.postMessage({ type, ...payload });
    channel.close();
  }
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error ||
        (response.status === 413
          ? 'Incident attachments are too large. Remove some photos and try again.'
          : 'Request failed')
    );
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function playAlertTone() {
  if (!window.AudioContext) {
    return;
  }
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = 860;
  gain.gain.value = 0.02;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}
