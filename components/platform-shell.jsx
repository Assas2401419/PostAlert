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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LayoutGrid,
  LayoutList,
  MapPinned,
  RadioTower,
  Search,
  ShieldCheck,
  Siren,
  TriangleAlert,
  UserRound
} from 'lucide-react';

import {
  CATEGORY_META,
  CATEGORY_SUBCATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  FALLBACK_CATEGORY_ICON,
  MAP_BOUNDS,
  PARISH_CENTERS,
  PARISHES,
  SEVERITY_META
} from '../lib/constants.js';
import {
  createStartTime,
  formatAgo,
  formatDateTime,
  haversineKm,
  projectPoint,
  readFileAsDataUrl,
  withinJamaica
} from '../lib/utils.js';
import { createSupabaseBrowserClient } from '../lib/supabase/client.js';

const INCIDENT_CACHE_KEY = 'jeip_cached_incidents';
const REPORT_QUEUE_KEY = 'jeip_report_queue';

export function PlatformShell({ page, incidentId = '' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session, status, update } = useSession();
  const channelRef = useRef(null);
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
  const [authConfirmation, setAuthConfirmation] = useState(null);
  const [resetPreview, setResetPreview] = useState(null);
  const [authorityAlert, setAuthorityAlert] = useState(null);

  const selectedIncidentId = page === 'incident' ? incidentId : searchParams.get('incident');
  const sessionUser = session?.user || null;
  const currentUser = profileBundle?.user || sessionUser;
  const canPost = Boolean(currentUser?.canPost);
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
              .filter((key) => key.startsWith('jeip-next-shell'))
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
    const channel = new BroadcastChannel('jeip-platform');
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
    }
  }, [page, showAuthorityRoute, currentUser?.parish, authorityFilters.parish, authorityFilters.status]);

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
    if (!currentUser?.parish) {
      return;
    }
    setAuthorityFilters((current) => ({
      ...current,
      parish: current.parish || currentUser.parish
    }));
  }, [currentUser?.parish]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      return undefined;
    }

    const channel = supabase
      .channel('jeip-realtime')
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
      const searchParams = new URLSearchParams({
        parish: authorityFilters.parish || currentUser?.parish || ''
      });
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
        playAlertTone();
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

  async function handleAuth(mode, payload) {
    try {
      setAuthConfirmation(null);
      setResetPreview(null);
      if (mode === 'login') {
        const result = await signIn('credentials', {
          email: payload.email,
          password: payload.password,
          redirect: false
        });
        if (result?.error) {
          throw new Error('Invalid email or password.');
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
        router.push('/');
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
    router.push('/');
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
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
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

  const headerStatus = !currentUser
    ? 'Public feed'
    : currentUser.role === 'authority_pending'
      ? 'Authority verification pending'
      : currentUser.permanentPostingBan
        ? 'Posting suspended permanently'
        : currentUser.restrictedUntil
          ? `Posting restricted until ${formatDateTime(currentUser.restrictedUntil)}`
          : currentUser.role === 'authority' || currentUser.role === 'admin'
            ? 'Authority access'
            : 'Citizen access';

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="app-grid absolute inset-0 pointer-events-none opacity-70" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--surface)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="brand-mark">
              <RadioTower aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-xl tracking-[0.08em] text-white sm:tracking-[0.12em]">
                PostAlert
              </p>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Next.js / Auth.js / Supabase-ready
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-2 lg:flex">
            <HeaderLink href="/">Feed</HeaderLink>
            <HeaderLink href="/report">Report</HeaderLink>
            <HeaderLink href="/trends">Trends</HeaderLink>
            {showAuthorityRoute ? <HeaderLink href="/authority">Authority</HeaderLink> : null}
            {currentUser ? <HeaderLink href="/profile">Profile</HeaderLink> : <HeaderLink href="/auth">Access</HeaderLink>}
          </nav>

          <div className="flex items-center gap-3">
            <StatusPill online={online} mode={status} />
            <div className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-right text-xs text-slate-300 md:block">
              <div className="font-semibold text-white">{headerStatus}</div>
              <div>{currentUser ? currentUser.name : 'Guest access'}</div>
            </div>
            {currentUser ? (
              <button
                className="ghost-button"
                onClick={() => signOut({ callbackUrl: '/auth' })}
              >
                Sign out
              </button>
            ) : (
              <button className="ghost-button" onClick={() => router.push('/auth')}>
                Sign in
              </button>
            )}
          </div>
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
            onOpenIncident={(incidentId) => openIncidentPage(incidentId, router)}
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
            onContinue={continueFromAuthConfirmation}
            onRequestReset={requestPasswordReset}
            onResetPassword={completePasswordReset}
            onSubmit={handleAuth}
            resetPreview={resetPreview}
          />
        ) : null}

        {page === 'report' ? (
          currentUser ? (
            <ReportWizard canPost={canPost} onSubmit={submitReport} user={currentUser} />
          ) : (
            <ProtectedMessage href="/auth" title="Sign in to report incidents" />
          )
        ) : null}

        {page === 'authority' ? (
          showAuthorityRoute ? (
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
            <ProtectedMessage href="/" title="Authority access is restricted to verified accounts" />
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
          currentUser ? (
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
          onClose={() => router.push('/')}
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

function HeaderLink({ href, children }) {
  const pathname = usePathname();
  const active = pathname === href || (href === '/' && pathname?.startsWith('/incidents/'));
  return (
    <Link href={href} className={`nav-link ${active ? 'nav-link-active' : ''}`}>
      {children}
    </Link>
  );
}

function StatusPill({ online, mode }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-300">
      <span className={online ? 'text-emerald-300' : 'text-amber-300'}>
        {online ? (mode === 'authenticated' ? 'Session live' : 'Online') : 'Offline'}
      </span>
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
          JEIP now runs through Next.js with Auth.js sessions, route-handler APIs, Supabase-ready data wiring, and a Vercel deployment shape.
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

            <IncidentMap
              incidents={incidents}
              onSelect={(incident) => {
                setPreviewIncident(incident);
                onOpenIncident(incident.id);
              }}
              userLocation={userLocation}
              highlightedIncidentId={selectedIncidentId}
            />

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
          <Link href="/" className="primary-button">
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
            <Link href="/" className="ghost-button inline-flex items-center gap-2">
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
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const sectionClassName =
    layout === 'page' ? 'surface-card space-y-5' : 'surface-muted';

  useEffect(() => {
    setNotes('');
    setComment('');
    setSelectedPhoto(null);
  }, [incident?.id]);

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
            <IncidentMap
              highlightedIncidentId={incident.id}
              incidents={[incident]}
              onSelect={() => {}}
              userLocation={null}
            />
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
                <div className="section-label">Record authority action</div>
                <textarea
                  className="field min-h-24"
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add operational notes for the public record."
                  value={notes}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  {['verify', 'respond', 'resolve', 'dismiss'].map((action) => (
                    <button
                      key={action}
                      className="ghost-button"
                      onClick={() => onAuthorityAction(incident.id, action, notes)}
                      type="button"
                    >
                      {action}
                    </button>
                  ))}
                </div>
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
                <div className="section-label">Authority action</div>
                <textarea
                  className="field min-h-24"
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add operational notes for the public record."
                  value={notes}
                />
                <div className="grid gap-2 sm:grid-cols-4">
                  {['verify', 'respond', 'resolve', 'dismiss'].map((action) => (
                    <button
                      key={action}
                      className="ghost-button"
                      onClick={() => onAuthorityAction(incident.id, action, notes)}
                      type="button"
                    >
                      {action}
                    </button>
                  ))}
                </div>
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

function AuthScreen({
  confirmation,
  onContinue,
  onRequestReset,
  onResetPassword,
  onSubmit,
  resetPreview
}) {
  const [mode, setMode] = useState('login');
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
    login: 'Sign in to JEIP',
    register: 'Create a citizen account',
    authority: 'Register as an authority user'
  };

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

  return (
    <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
      <div className="surface-card flex flex-col justify-between">
        <div className="space-y-4">
          <div className="section-kicker">Secure platform access</div>
          <h2 className="font-display text-4xl text-white">{formTitle[mode]}</h2>
          <p className="max-w-xl text-sm leading-7 text-slate-300">
            Citizens can report and validate incidents. Verified authority accounts unlock the operational dashboard and response actions.
          </p>
        </div>
      <div className="mt-8 flex flex-wrap gap-3">
          <button
            className={`toggle-button ${mode === 'login' ? 'toggle-button-active' : ''}`}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
          <button
            className={`toggle-button ${mode === 'register' ? 'toggle-button-active' : ''}`}
            onClick={() => setMode('register')}
          >
            Citizen
          </button>
          <button
            className={`toggle-button ${mode === 'authority' ? 'toggle-button-active' : ''}`}
            onClick={() => setMode('authority')}
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
            <span className="section-label">Email</span>
            <input
              className="field"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              required
            />
          </label>
          <label className="space-y-2">
            <span className="section-label">Password</span>
            <input
              className="field"
              type="password"
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              required
            />
          </label>
          {mode !== 'login' ? (
            <>
              <label className="space-y-2">
                <span className="section-label">Full name</span>
                <input
                  className="field"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="section-label">Parish</span>
                <select
                  className="field"
                  value={form.parish}
                  onChange={(event) => setForm((current) => ({ ...current, parish: event.target.value }))}
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
                  onChange={(event) =>
                    setForm((current) => ({ ...current, organizationName: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="space-y-2">
                <span className="section-label">Badge or ID number</span>
                <input
                  className="field"
                  value={form.badgeNumber}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, badgeNumber: event.target.value }))
                  }
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
                      className="field"
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
                  <label className="space-y-2">
                    <span className="section-label">New password</span>
                    <input
                      className="field"
                      type="password"
                      minLength={8}
                      value={resetForm.password}
                      onChange={(event) =>
                        setResetForm((current) => ({ ...current, password: event.target.value }))
                      }
                    />
                  </label>
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
  const [error, setError] = useState('');
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

  async function handleFiles(fileList) {
    const files = Array.from(fileList).slice(0, 3);
    const invalid = files.find((file) => !['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalid) {
      setError('Only JPEG or PNG files up to 5MB are allowed.');
      return;
    }
    const photos = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: await readFileAsDataUrl(file)
      }))
    );
    setForm((current) => ({ ...current, photos }));
    setError('');
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
          <div className="flex flex-wrap gap-3">
            <button type="button" className="primary-button" onClick={requestLocation}>Use current GPS location</button>
            <button type="button" className="ghost-button" onClick={() => setForm((current) => ({ ...current, latitude: 17.9712, longitude: -76.7928, address: 'Kingston, Jamaica' }))}>Reset to Kingston</button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-2">
              <span className="section-label">Manual parish fallback</span>
              <select
                className="field"
                value={form.address.replace(', Jamaica', '')}
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
          <IncidentMap incidents={[]} editable value={form} onPick={(coords) => setForm((current) => ({ ...current, latitude: coords.latitude, longitude: coords.longitude }))} />
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
              <span className="section-label">Upload up to 3 photos</span>
              <input className="field" type="file" accept="image/jpeg,image/png" multiple onChange={(event) => handleFiles(event.target.files)} />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              {form.photos.map((photo) => (
                <img key={photo.name} src={photo.dataUrl} alt={photo.name} className="h-28 w-full rounded-[24px] object-cover" />
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
            <SummaryCard label="Location" value={`${form.latitude}, ${form.longitude}`} />
            <SummaryCard label="Photos" value={`${form.photos.length}`} />
          </div>
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-300">{form.description}</div>
        </div>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

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
            <button type="submit" className="primary-button" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit incident'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function AuthorityScreen({ dashboard, filters, pendingAuthorities, user, onAction, onFiltersChange, onApprove }) {
  const [notesByIncident, setNotesByIncident] = useState({});

  if (!dashboard) {
    return <div className="surface-card text-sm text-slate-400">Loading authority dashboard…</div>;
  }

  return (
    <section className="space-y-6">
      <div className="surface-card">
        <div className="section-kicker">Authority operations</div>
        <h2 className="font-display text-3xl text-white">{dashboard.parish} command view</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {dashboard.isAdmin ? (
            <label className="space-y-2">
              <span className="section-label">Parish selector</span>
              <select
                className="field"
                value={filters.parish}
                onChange={(event) =>
                  onFiltersChange((current) => ({ ...current, parish: event.target.value }))
                }
              >
                {PARISHES.map((parish) => (
                  <option key={parish} value={parish}>
                    {parish}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Total active" value={String(dashboard.stats.totalActive)} />
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
        <div className="section-label mb-4">Jurisdiction incidents</div>
        <div className="space-y-3">
          {dashboard.incidents.map((incident) => (
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
                  <textarea
                    className="field min-h-24 lg:min-w-80"
                    placeholder="Add public notes for this action."
                    value={notesByIncident[incident.id] || ''}
                    onChange={(event) =>
                      setNotesByIncident((current) => ({
                        ...current,
                        [incident.id]: event.target.value
                      }))
                    }
                  />
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {['verify', 'respond', 'resolve', 'dismiss'].map((action) => (
                    <button
                      key={action}
                      className="ghost-button"
                      disabled={dashboard.readOnly}
                      onClick={() => onAction(incident.id, action, notesByIncident[incident.id] || '')}
                    >
                      {action}
                    </button>
                  ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
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
  const categories = Object.entries(trendsBundle.counts);
  const highestCount = Math.max(...categories.map(([, count]) => count), 1);

  return (
    <section className="space-y-6">
      <div className="surface-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="section-kicker">Historical trends</div>
            <h2 className="font-display text-3xl text-white">Safety patterns and hot spots</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select className="field" value={trendsBundle.period} onChange={(event) => onChangePeriod(event.target.value)}>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
            <select className="field" value={trendsBundle.parish} onChange={(event) => onChangeParish(event.target.value)}>
              <option value="">All parishes</option>
              {PARISHES.map((parish) => (
                <option key={parish} value={parish}>{parish}</option>
              ))}
            </select>
            <input
              className="field"
              type="date"
              value={trendsBundle.dateFrom}
              onChange={(event) => onChangeDateFrom(event.target.value)}
            />
            <input
              className="field"
              type="date"
              value={trendsBundle.dateTo}
              onChange={(event) => onChangeDateTo(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="24h incidents" value={String(trendsBundle.summary['24h'])} />
        <SummaryCard label="7d incidents" value={String(trendsBundle.summary['7d'])} />
        <SummaryCard label="30d incidents" value={String(trendsBundle.summary['30d'])} />
      </div>

      {trendsBundle.total < 3 ? (
        <div className="surface-card text-sm text-slate-300">
          Minimum data threshold not met yet. Add at least three incidents in the selected period for stronger trend insight.
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="surface-card space-y-4">
            <div className="section-label">Incident counts by category</div>
            {categories.map(([category, count]) => (
              <div key={category} className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>{category}</span>
                  <span>{count}</span>
                </div>
                <div className="h-3 rounded-full bg-white/5">
                  <div className="h-3 rounded-full bg-amber-400" style={{ width: `${(count / highestCount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-6">
            <div className="surface-card">
              <div className="section-label mb-4">Heat map</div>
              <HeatGrid points={trendsBundle.heatmap} />
            </div>
            <div className="surface-card">
              <div className="section-label mb-4">Top 5 categories</div>
              <div className="space-y-3">
                {trendsBundle.top.map((entry, index) => (
                  <div key={entry.category} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <span className="text-white">{index + 1}. {entry.category}</span>
                    <span className="text-slate-400">{entry.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
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

function openIncidentPage(incidentId, router) {
  const destination = incidentDetailPath(incidentId);
  if (typeof window !== 'undefined') {
    window.location.assign(destination);
    return;
  }
  router.push(destination);
}

function broadcast(type, payload = {}) {
  if (typeof window !== 'undefined' && window.BroadcastChannel) {
    const channel = new BroadcastChannel('jeip-platform');
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
    throw new Error(data.error || 'Request failed');
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
