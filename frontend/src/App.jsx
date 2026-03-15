import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  AlertTriangle,
  Bell,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CloudRain,
  Flame,
  LayoutGrid,
  LayoutList,
  MapPinned,
  Megaphone,
  RadioTower,
  Search,
  ShieldAlert,
  ShieldCheck,
  Siren,
  TriangleAlert,
  UserRound,
  Waves,
  Wrench,
  XCircle
} from 'lucide-react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useSearchParams
} from 'react-router-dom';
import { io } from 'socket.io-client';

import { apiRequest, storage } from './lib/api.js';

const PARISHES = [
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

const CATEGORY_META = {
  Crime: { icon: ShieldAlert, accent: 'text-rose-500', surface: 'bg-rose-500/10' },
  Accident: { icon: CarFront, accent: 'text-amber-500', surface: 'bg-amber-500/10' },
  'Natural Disaster': { icon: CloudRain, accent: 'text-cyan-500', surface: 'bg-cyan-500/10' },
  Infrastructure: { icon: Wrench, accent: 'text-lime-500', surface: 'bg-lime-500/10' },
  'Community Alert': { icon: Megaphone, accent: 'text-blue-500', surface: 'bg-blue-500/10' }
};

const CATEGORY_SUBCATEGORIES = {
  Crime: ['Robbery', 'Assault', 'Suspicious Activity', 'Burglary', 'Violence'],
  Accident: ['Vehicle Collision', 'Pedestrian Injury', 'Road Hazard', 'Fire', 'Marine Incident'],
  'Natural Disaster': ['Flooding', 'Landslide', 'Hurricane Damage', 'Earthquake Impact', 'Storm Surge'],
  Infrastructure: ['Power Outage', 'Water Supply', 'Road Damage', 'Collapsed Drain', 'Bridge Issue'],
  'Community Alert': ['Missing Person', 'School Lockdown', 'Public Health', 'Crowd Surge', 'Evacuation']
};

const SEVERITY_META = {
  low: { label: 'Low', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  medium: { label: 'Medium', chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  high: { label: 'High', chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  critical: { label: 'Critical', chip: 'bg-rose-500/15 text-rose-300 border-rose-500/30' }
};

const MAP_BOUNDS = {
  latMin: 17.65,
  latMax: 18.55,
  lngMin: -78.45,
  lngMax: -76.1
};

const defaultFilters = {
  categories: [],
  severities: [],
  timeRange: '24h',
  parish: ''
};

const defaultPrefs = {
  enabled: false,
  categories: Object.keys(CATEGORY_SUBCATEGORIES),
  minSeverity: 'high',
  radiusKm: 5,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:00'
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const socketRef = useRef(null);
  const listEndRef = useRef(null);
  const [token, setToken] = useState(storage.getToken());
  const [user, setUser] = useState(null);
  const [incidents, setIncidents] = useState(storage.getIncidentCache());
  const [feedView, setFeedView] = useState('map');
  const [filters, setFilters] = useState(defaultFilters);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [detailIncident, setDetailIncident] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [pendingAuthorities, setPendingAuthorities] = useState([]);
  const [profileBundle, setProfileBundle] = useState(null);
  const [activityBundle, setActivityBundle] = useState(null);
  const [trendsBundle, setTrendsBundle] = useState({
    counts: {},
    heatmap: [],
    top: [],
    total: 0,
    period: '24h',
    parish: ''
  });
  const [queue, setQueue] = useState(storage.getQueuedReports());
  const [online, setOnline] = useState(window.navigator.onLine);
  const [flash, setFlash] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [authorityAlert, setAuthorityAlert] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const selectedIncidentId = searchParams.get('incident');
  const canPost = Boolean(user?.canPost);
  const showAuthorityRoute = user?.role === 'authority' || user?.role === 'admin';

  useEffect(() => {
    if (!flash) {
      return undefined;
    }

    const timeout = window.setTimeout(() => setFlash(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [flash]);

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
    if (!token) {
      setUser(null);
      return;
    }

    apiRequest('/api/auth/me', { token })
      .then(({ user: nextUser }) => setUser(nextUser))
      .catch(() => {
        storage.clearToken();
        setToken('');
        setUser(null);
      });
  }, [token]);

  useEffect(() => {
    const socket = io('/', {
      auth: token ? { token } : {},
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      const location = user?.lastKnownLocation || { lat: 17.9712, lng: -76.7928 };
      socket.emit('subscribe:location', {
        latitude: location.lat,
        longitude: location.lng,
        radiusKm: user?.notificationPrefs?.radiusKm || 5
      });
    });

    socket.on('disconnect', () => setSocketConnected(false));

    socket.on('incident:created', (incident) => {
      startTransition(() => {
        setIncidents((current) => {
          const merged = [incident, ...current.filter((entry) => entry.id !== incident.id)];
          storage.setIncidentCache(merged);
          return merged;
        });
      });
    });

    socket.on('incident:updated', (incident) => {
      startTransition(() => {
        setIncidents((current) => {
          const merged = current.map((entry) => (entry.id === incident.id ? incident : entry));
          storage.setIncidentCache(merged);
          return merged;
        });
      });
      setDetailIncident((current) => (current?.id === incident.id ? incident : current));
    });

    socket.on('incident:confirmed', ({ id, confirmationCount, disputeCount }) => {
      setIncidents((current) =>
        current.map((entry) =>
          entry.id === id
            ? { ...entry, confirmationCount, disputeCount }
            : entry
        )
      );
      setDetailIncident((current) =>
        current?.id === id ? { ...current, confirmationCount, disputeCount } : current
      );
    });

    socket.on('authority:alert', ({ incident }) => {
      if (!showAuthorityRoute) {
        return;
      }

      setAuthorityAlert(incident);
      playAlertTone();
    });

    socket.on('notification:created', async (notification) => {
      if (location.pathname === '/profile') {
        loadProfileData();
      }

      await showBrowserNotification(notification, navigate);
    });

    return () => {
      socket.disconnect();
    };
  }, [token, navigate, user?.lastKnownLocation?.lat, user?.lastKnownLocation?.lng, showAuthorityRoute, location.pathname]);

  useEffect(() => {
    loadIncidents(1, false);
  }, [filters.timeRange, filters.parish, filters.categories.join(','), filters.severities.join(','), online]);

  useEffect(() => {
    const target = listEndRef.current;
    if (!target) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingFeed && feedView === 'list') {
          loadIncidents(page + 1, true);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [feedView, hasMore, loadingFeed, page]);

  useEffect(() => {
    if (!selectedIncidentId) {
      setDetailIncident(null);
      return;
    }

    setLoadingDetail(true);
    socketRef.current?.emit('subscribe:incident', { incidentId: selectedIncidentId });
    apiRequest(`/api/incidents/${selectedIncidentId}`, { token })
      .then(({ incident }) => setDetailIncident(incident))
      .catch((error) => setFlash({ tone: 'error', message: error.message }))
      .finally(() => setLoadingDetail(false));

    return () => {
      socketRef.current?.emit('unsubscribe:incident', { incidentId: selectedIncidentId });
    };
  }, [selectedIncidentId, token]);

  useEffect(() => {
    if (!online || !token || !queue.length) {
      return;
    }

    flushQueuedReports();
  }, [online, token, queue.length]);

  useEffect(() => {
    if (!location.pathname.startsWith('/authority') || !showAuthorityRoute || !token) {
      return;
    }

    loadAuthorityData();
    if (user?.role === 'admin') {
      apiRequest('/api/admin/authorities/pending', { token })
        .then(({ items }) => setPendingAuthorities(items))
        .catch(() => {});
    }
  }, [location.pathname, showAuthorityRoute, token, user?.parish, user?.role]);

  useEffect(() => {
    if (location.pathname === '/profile' && token) {
      loadProfileData();
    }
  }, [location.pathname, token]);

  useEffect(() => {
    if (location.pathname === '/trends') {
      loadTrendData(trendsBundle.period, trendsBundle.parish);
    }
  }, [location.pathname, trendsBundle.period, trendsBundle.parish]);

  async function loadIncidents(nextPage = 1, append = false) {
    setLoadingFeed(true);
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
      const response = await apiRequest(`/api/incidents?${query.toString()}`, { token });
      setPage(nextPage);
      setHasMore(response.hasMore);
      setIncidents((current) => {
        const items = append ? [...current, ...response.items.filter((item) => !current.some((entry) => entry.id === item.id))] : response.items;
        storage.setIncidentCache(items);
        return items;
      });
    } catch (error) {
      if (!online) {
        setIncidents(storage.getIncidentCache());
        setFlash({ tone: 'warning', message: 'Offline mode: showing cached incidents from the last successful sync.' });
      } else {
        setFlash({ tone: 'error', message: error.message });
      }
    } finally {
      setLoadingFeed(false);
    }
  }

  async function loadAuthorityData() {
    try {
      const response = await apiRequest(`/api/authority/dashboard?parish=${encodeURIComponent(user?.parish || '')}`, {
        token
      });
      setDashboard(response);
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function loadProfileData() {
    try {
      const [profile, incidentsResponse, activity] = await Promise.all([
        apiRequest('/api/profile', { token }),
        apiRequest('/api/profile/incidents', { token }),
        apiRequest('/api/profile/activity', { token })
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

  async function loadTrendData(period, parish) {
    try {
      const suffix = new URLSearchParams({
        period,
        ...(parish ? { parish } : {})
      }).toString();
      const [counts, heatmap, top] = await Promise.all([
        apiRequest(`/api/trends/counts?${suffix}`),
        apiRequest(`/api/trends/heatmap?${suffix}`),
        apiRequest(`/api/trends/top-categories?${suffix}`)
      ]);
      setTrendsBundle({
        counts: counts.counts,
        total: counts.total,
        heatmap: heatmap.items,
        top: top.items,
        period,
        parish
      });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function handleAuth(action, payload) {
    try {
      const endpoint =
        action === 'login'
          ? '/api/auth/login'
          : action === 'authority'
            ? '/api/auth/register/authority'
            : '/api/auth/register';
      const response = await apiRequest(endpoint, {
        method: 'POST',
        body: payload
      });
      storage.setToken(response.token);
      setToken(response.token);
      setUser(response.user);
      setFlash({
        tone: 'success',
        message:
          response.message || 'Authentication successful. You can now access the platform.'
      });
      navigate('/feed');
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  function logout() {
    storage.clearToken();
    setToken('');
    setUser(null);
    navigate('/feed');
  }

  async function submitReport(payload) {
    if (!token) {
      navigate('/auth');
      return;
    }

    if (!online) {
      const queued = [...queue, { ...payload, queuedAt: new Date().toISOString() }];
      setQueue(queued);
      storage.setQueuedReports(queued);
      setFlash({
        tone: 'warning',
        message: 'You are offline. This incident has been queued and will submit automatically when the connection returns.'
      });
      return;
    }

    try {
      const response = await apiRequest('/api/incidents', {
        method: 'POST',
        token,
        body: payload
      });
      setFlash({
        tone: 'success',
        message: response.photoWarning || 'Incident submitted successfully.'
      });
      await loadIncidents(1, false);
      navigate(`/feed?incident=${response.incident.id}`);
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function flushQueuedReports() {
    const items = [...queue];
    for (const queued of items) {
      try {
        await apiRequest('/api/incidents', {
          method: 'POST',
          token,
          body: queued
        });
        setQueue((current) => {
          const nextItems = current.filter((entry) => entry.queuedAt !== queued.queuedAt);
          storage.setQueuedReports(nextItems);
          return nextItems;
        });
      } catch {
        break;
      }
    }

    if (items.length) {
      setFlash({ tone: 'success', message: 'Queued offline reports were submitted.' });
      loadIncidents(1, false);
    }
  }

  async function handleVote(action) {
    if (!selectedIncidentId || !token) {
      navigate('/auth');
      return;
    }

    try {
      await apiRequest(`/api/incidents/${selectedIncidentId}/${action}`, {
        method: 'POST',
        token
      });
      const detail = await apiRequest(`/api/incidents/${selectedIncidentId}`, { token });
      setDetailIncident(detail.incident);
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function handleAuthorityAction(incidentId, action, notes) {
    try {
      const response = await apiRequest(`/api/authority/incidents/${incidentId}/${action}`, {
        method: 'POST',
        token,
        body: { notes }
      });
      setDetailIncident((current) => (current?.id === incidentId ? response.incident : current));
      await Promise.all([loadAuthorityData(), loadIncidents(1, false)]);
      setFlash({ tone: 'success', message: `Authority action "${action}" recorded.` });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function approveAuthority(authorityId) {
    try {
      await apiRequest(`/api/admin/authorities/${authorityId}/approve`, {
        method: 'POST',
        token
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
        token,
        body: payload
      });
      await loadProfileData();
      const me = await apiRequest('/api/auth/me', { token });
      setUser(me.user);
      setFlash({ tone: 'success', message: 'Profile saved.' });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function updateNotificationPrefs(payload) {
    try {
      let nextPrefs = payload;
      if (payload.enabled && window.Notification && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setFlash({ tone: 'warning', message: 'Notification permission was not granted.' });
          return;
        }

        await apiRequest('/api/notifications/register', {
          method: 'POST',
          token,
          body: {
            token: window.crypto.randomUUID(),
            platform: 'web'
          }
        });
      }

      const response = await apiRequest('/api/notifications/preferences', {
        method: 'PUT',
        token,
        body: nextPrefs
      });
      setUser((current) => ({ ...current, notificationPrefs: response.preferences }));
      await loadProfileData();
      setFlash({ tone: 'success', message: 'Notification preferences updated.' });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  async function submitAppeal(payload) {
    try {
      await apiRequest('/api/moderation/appeals', {
        method: 'POST',
        token,
        body: payload
      });
      setFlash({ tone: 'success', message: 'Strike appeal submitted.' });
    } catch (error) {
      setFlash({ tone: 'error', message: error.message });
    }
  }

  const headerStatus = useMemo(() => {
    if (!user) {
      return 'Public feed';
    }

    if (user.role === 'authority_pending') {
      return 'Authority verification pending';
    }

    if (user.permanentPostingBan) {
      return 'Posting suspended permanently';
    }

    if (user.restrictedUntil) {
      return `Posting restricted until ${formatDateTime(user.restrictedUntil)}`;
    }

    return user.role === 'authority' || user.role === 'admin' ? 'Authority access' : 'Citizen access';
  }, [user]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="app-grid absolute inset-0 pointer-events-none opacity-70" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--surface)]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <div className="brand-mark">
              <RadioTower className="h-5 w-5" />
            </div>
            <div>
              <p className="font-display text-xl tracking-[0.2em] text-white">JEIP</p>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                Jamaica Emergency Intelligence Platform
              </p>
            </div>
          </div>

          <nav className="hidden items-center gap-2 lg:flex">
            <HeaderLink to="/feed">Feed</HeaderLink>
            <HeaderLink to="/report">Report</HeaderLink>
            <HeaderLink to="/trends">Trends</HeaderLink>
            {showAuthorityRoute ? <HeaderLink to="/authority">Authority</HeaderLink> : null}
            {user ? <HeaderLink to="/profile">Profile</HeaderLink> : <HeaderLink to="/auth">Access</HeaderLink>}
          </nav>

          <div className="flex items-center gap-3">
            <StatusPill connected={socketConnected} online={online} />
            <div className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-right text-xs text-slate-300 md:block">
              <div className="font-semibold text-white">{headerStatus}</div>
              <div>{user ? user.name : 'Guest access'}</div>
            </div>
            {user ? (
              <button className="ghost-button" onClick={logout}>
                Sign out
              </button>
            ) : (
              <button className="ghost-button" onClick={() => navigate('/auth')}>
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
        <HeroStrip user={user} queueCount={queue.length} incidentCount={incidents.length} />

        <Routes>
          <Route
            path="/"
            element={<Navigate to="/feed" replace />}
          />
          <Route
            path="/feed"
            element={
              <FeedPage
                incidents={incidents}
                loading={loadingFeed}
                hasMore={hasMore}
                filters={filters}
                feedView={feedView}
                listEndRef={listEndRef}
                onFiltersChange={setFilters}
                onViewChange={setFeedView}
                onOpenIncident={(incidentId) => {
                  const nextParams = new URLSearchParams(searchParams);
                  nextParams.set('incident', incidentId);
                  setSearchParams(nextParams);
                }}
                selectedIncidentId={selectedIncidentId}
                userLocation={user?.lastKnownLocation}
              />
            }
          />
          <Route
            path="/auth"
            element={<AuthPage onSubmit={handleAuth} />}
          />
          <Route
            path="/report"
            element={
              <ProtectedRoute user={user}>
                <ReportWizard
                  canPost={canPost}
                  onSubmit={submitReport}
                  user={user}
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/authority"
            element={
              <ProtectedRoute user={user} requireAuthority>
                <AuthorityPage
                  dashboard={dashboard}
                  pendingAuthorities={pendingAuthorities}
                  onAction={handleAuthorityAction}
                  onApprove={approveAuthority}
                />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trends"
            element={
              <TrendsPage
                trendsBundle={trendsBundle}
                onChangePeriod={(period) =>
                  setTrendsBundle((current) => ({
                    ...current,
                    period
                  }))
                }
                onChangeParish={(parish) =>
                  setTrendsBundle((current) => ({
                    ...current,
                    parish
                  }))
                }
              />
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute user={user}>
                <ProfilePage
                  bundle={profileBundle}
                  activityBundle={activityBundle}
                  onSave={updateProfile}
                  onPreferencesSave={updateNotificationPrefs}
                  onAppeal={submitAppeal}
                />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>

      <IncidentDrawer
        incident={detailIncident}
        loading={loadingDetail}
        user={user}
        onClose={() => {
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('incident');
          setSearchParams(nextParams);
        }}
        onConfirm={() => handleVote('confirm')}
        onDispute={() => handleVote('dispute')}
        onAuthorityAction={handleAuthorityAction}
      />
    </div>
  );
}

function HeaderLink({ to, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
    >
      {children}
    </NavLink>
  );
}

function StatusPill({ connected, online }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-slate-300">
      <span className={connected && online ? 'text-emerald-300' : 'text-amber-300'}>
        {online ? (connected ? 'Live sync' : 'Reconnecting') : 'Offline'}
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
    <div className={`mx-auto mt-4 max-w-7xl rounded-3xl border px-4 py-3 text-sm ${tones[flash.tone]}`}>
      {flash.message}
    </div>
  );
}

function OfflineBanner({ queueCount }) {
  return (
    <div className="mx-auto mt-4 flex max-w-7xl items-center justify-between rounded-3xl border border-amber-500/30 bg-amber-500/12 px-4 py-3 text-sm text-amber-100">
      <span>Connection lost. Cached incidents remain available.</span>
      <span>{queueCount} queued report{queueCount === 1 ? '' : 's'}</span>
    </div>
  );
}

function AlertRibbon({ incident, onDismiss }) {
  return (
    <div className="mx-auto mt-4 flex max-w-7xl items-center justify-between gap-4 rounded-3xl border border-rose-500/30 bg-rose-500/15 px-4 py-3 text-sm text-rose-50">
      <div className="flex items-center gap-3">
        <Siren className="h-5 w-5" />
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
          JEIP blends community reporting with authority action tracking, real-time map intelligence, moderation controls, and offline resilience.
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
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 font-display text-3xl text-white">{value}</div>
    </div>
  );
}

function FeedPage({
  incidents,
  loading,
  hasMore,
  filters,
  feedView,
  onFiltersChange,
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
                <LayoutGrid className="h-4 w-4" />
                Map
              </button>
              <button className={`toggle-button ${feedView === 'list' ? 'toggle-button-active' : ''}`} onClick={() => onViewChange('list')}>
                <LayoutList className="h-4 w-4" />
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

          <div ref={listEndRef} className="mt-6 rounded-2xl border border-dashed border-white/10 px-4 py-3 text-center text-sm text-slate-400">
            {hasMore ? 'Scroll for more incidents' : 'No more incidents'}
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
          <Search className="h-4 w-4" />
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
          <TriangleAlert className="h-4 w-4" />
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
            <Clock3 className="h-4 w-4" />
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
            <MapPinned className="h-4 w-4" />
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
    <div
      ref={containerRef}
      className={`map-shell ${editable ? 'cursor-crosshair' : ''}`}
      onClick={handleMapClick}
    >
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
        <Marker
          incident={{
            id: 'user-location',
            latitude: userLocation.lat,
            longitude: userLocation.lng,
            severity: 'low'
          }}
          variant="user"
        />
      ) : null}

      {incidents.map((incident) => (
        <Marker
          key={incident.id}
          incident={incident}
          highlighted={highlightedIncidentId === incident.id}
          onClick={(event) => {
            event.stopPropagation();
            if (editable) {
              return;
            }
            onSelect(incident);
          }}
        />
      ))}

      {editable && value?.latitude && value?.longitude ? (
        <Marker
          incident={{
            id: 'draft',
            latitude: value.latitude,
            longitude: value.longitude,
            severity: 'critical'
          }}
          variant="draft"
        />
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
      className={`map-marker ${className} ${highlighted ? 'scale-125 ring-2 ring-white/60' : ''}`}
      style={{ left: `${left}%`, top: `${top}%` }}
      onClick={onClick}
      type="button"
    />
  );
}

function IncidentCard({ incident, selected, onClick, userLocation }) {
  const Icon = CATEGORY_META[incident.category]?.icon || AlertTriangle;
  const distance = userLocation?.lat
    ? haversineKm(userLocation.lat, userLocation.lng, incident.latitude, incident.longitude).toFixed(1)
    : null;

  return (
    <button
      className={`incident-row ${selected ? 'incident-row-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <div className={`icon-shell ${CATEGORY_META[incident.category]?.surface || 'bg-white/10'} ${CATEGORY_META[incident.category]?.accent || 'text-white'}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate text-base font-semibold text-white">{incident.title}</div>
          <SeverityBadge severity={incident.severity} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span>{formatAgo(incident.createdAt)}</span>
          <span>{incident.confirmationCount} confirmations</span>
          {distance ? <span>{distance} km away</span> : null}
        </div>
      </div>
      <ChevronRight className="h-5 w-5 text-slate-500" />
    </button>
  );
}

function IncidentDrawer({ incident, loading, user, onClose, onConfirm, onDispute, onAuthorityAction }) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setNotes('');
  }, [incident?.id]);

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
            <h3 className="font-display text-3xl text-white">{incident?.title || 'Loading incident'}</h3>
          </div>
          <button className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-400">Loading incident details…</div>
        ) : incident ? (
          <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <CategoryBadge category={incident.category} />
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>

            <p className="text-sm leading-7 text-slate-300">{incident.description}</p>

            <div className="grid gap-4 md:grid-cols-2">
              <InfoBlock label="Reported">
                {formatDateTime(incident.createdAt)}
              </InfoBlock>
              <InfoBlock label="Reporter">
                {incident.reporter?.name} · {incident.reporter?.parish}
              </InfoBlock>
              <InfoBlock label="Confirmations">
                {incident.confirmationCount}
              </InfoBlock>
              <InfoBlock label="Disputes">
                {incident.disputeCount}
              </InfoBlock>
            </div>

            <IncidentMap
              incidents={[incident]}
              userLocation={null}
              highlightedIncidentId={incident.id}
              onSelect={() => {}}
            />

            {incident.photos?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {incident.photos.map((photo) => (
                  <img
                    key={photo.id}
                    src={photo.url}
                    alt={photo.name}
                    className="h-40 w-full rounded-[24px] object-cover"
                  />
                ))}
              </div>
            ) : null}

            <div className="surface-muted">
              <div className="section-label mb-3">Community confirmations</div>
              <div className="space-y-2 text-sm text-slate-300">
                {incident.confirmations?.length ? incident.confirmations.map((confirmation) => (
                  <div key={confirmation.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                    <span>{confirmation.userName}</span>
                    <span className="text-slate-400">
                      {confirmation.action} · {formatAgo(confirmation.createdAt)}
                    </span>
                  </div>
                )) : <div className="text-slate-400">No community actions yet.</div>}
              </div>
            </div>

            <div className="surface-muted">
              <div className="section-label mb-3">Authority actions</div>
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

            {user && incident.canAct ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <button className="primary-button" onClick={onConfirm}>
                  Confirm
                </button>
                <button className="ghost-button !border-rose-500/30 !text-rose-100" onClick={onDispute}>
                  Dispute
                </button>
              </div>
            ) : null}

            {user?.role === 'authority' || user?.role === 'admin' ? (
              <div className="space-y-3 rounded-[28px] border border-white/10 bg-white/5 p-4">
                <div className="section-label">Authority action</div>
                <textarea
                  className="field min-h-24"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add operational notes for the public record."
                />
                <div className="grid gap-2 sm:grid-cols-4">
                  {['verify', 'respond', 'resolve', 'dismiss'].map((action) => (
                    <button
                      key={action}
                      className="ghost-button"
                      onClick={() => onAuthorityAction(incident.id, action, notes)}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function AuthPage({ onSubmit }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    parish: 'Kingston',
    organizationName: '',
    badgeNumber: ''
  });

  const formTitle = {
    login: 'Sign in to JEIP',
    register: 'Create a citizen account',
    authority: 'Register as an authority user'
  };

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
          <button className={`toggle-button ${mode === 'login' ? 'toggle-button-active' : ''}`} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button className={`toggle-button ${mode === 'register' ? 'toggle-button-active' : ''}`} onClick={() => setMode('register')}>
            Citizen
          </button>
          <button className={`toggle-button ${mode === 'authority' ? 'toggle-button-active' : ''}`} onClick={() => setMode('authority')}>
            Authority
          </button>
        </div>
      </div>

      <form
        className="surface-card space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(mode, form);
        }}
      >
        <label className="space-y-2">
          <span className="section-label">Email</span>
          <input className="field" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
        </label>

        <label className="space-y-2">
          <span className="section-label">Password</span>
          <input className="field" type="password" minLength={8} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
        </label>

        {mode !== 'login' ? (
          <>
            <label className="space-y-2">
              <span className="section-label">Full name</span>
              <input className="field" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </label>
            <label className="space-y-2">
              <span className="section-label">Parish</span>
              <select className="field" value={form.parish} onChange={(event) => setForm((current) => ({ ...current, parish: event.target.value }))}>
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
              <input className="field" value={form.organizationName} onChange={(event) => setForm((current) => ({ ...current, organizationName: event.target.value }))} required />
            </label>
            <label className="space-y-2">
              <span className="section-label">Badge or ID number</span>
              <input className="field" value={form.badgeNumber} onChange={(event) => setForm((current) => ({ ...current, badgeNumber: event.target.value }))} required />
            </label>
            <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
              Authority accounts are created in read-only mode until an administrator approves verification.
            </p>
          </>
        ) : null}

        <button className="primary-button w-full" type="submit">
          {mode === 'login' ? 'Access platform' : 'Create access'}
        </button>
      </form>
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
    const invalid = files.find(
      (file) => !['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024
    );
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

  async function requestLocation() {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported in this browser.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(5));
        const longitude = Number(position.coords.longitude.toFixed(5));
        setForm((current) => ({
          ...current,
          latitude,
          longitude
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
            <button
              key={index}
              type="button"
              className={`step-chip ${step === index ? 'step-chip-active' : ''}`}
              onClick={() => setStep(index)}
            >
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
                <button
                  key={category}
                  type="button"
                  className={`category-tile ${form.category === category ? 'category-tile-active' : ''}`}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      category,
                      subcategory: CATEGORY_SUBCATEGORIES[category][0]
                    }))
                  }
                >
                  <div className={`icon-shell ${meta.surface} ${meta.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="text-sm font-semibold text-white">{category}</div>
                </button>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="section-label">Subcategory</span>
              <select
                className="field"
                value={form.subcategory}
                onChange={(event) => setForm((current) => ({ ...current, subcategory: event.target.value }))}
              >
                {CATEGORY_SUBCATEGORIES[form.category].map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
              <input
                type="checkbox"
                checked={form.anonymous}
                onChange={(event) => setForm((current) => ({ ...current, anonymous: event.target.checked }))}
              />
              <span className="text-sm text-slate-300">Report anonymously in the public detail view</span>
            </label>
          </div>

          <label className="space-y-2">
            <span className="section-label">Description</span>
            <textarea
              className="field min-h-36"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value.slice(0, 500) }))}
              placeholder="Describe what happened, current risk, and anything responders should know."
            />
            <div className="text-right text-xs text-slate-400">
              {form.description.length} / 500 characters
            </div>
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
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

          <div className="grid gap-4 md:grid-cols-3">
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

          <IncidentMap
            incidents={[]}
            editable
            value={form}
            onPick={(coords) =>
              setForm((current) => ({
                ...current,
                latitude: coords.latitude,
                longitude: coords.longitude
              }))
            }
          />
          <div className={`rounded-2xl border px-4 py-3 text-sm ${withinJamaica(form.latitude, form.longitude) ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-rose-500/30 bg-rose-500/10 text-rose-100'}`}>
            {withinJamaica(form.latitude, form.longitude)
              ? 'Selected coordinates are within Jamaica.'
              : 'Selected coordinates are outside Jamaica. Move the pin or enter a valid location.'}
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
          <div className="space-y-4">
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
                <button
                  key={severity}
                  type="button"
                  className={`severity-tile ${form.severity === severity ? 'severity-tile-active' : ''}`}
                  onClick={() => setForm((current) => ({ ...current, severity }))}
                >
                  <div className={`severity-pill ${meta.chip}`}>{meta.label}</div>
                  <div className="text-sm text-slate-300">
                    {severity === 'critical' ? 'Immediate life-threatening risk' : 'Community alert priority'}
                  </div>
                </button>
              ))}
            </div>
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
          <div className="rounded-[24px] border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-300">
            {form.description}
          </div>
        </div>
      ) : null}

      {error ? <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="ghost-button" onClick={() => setStep((current) => Math.max(current - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex gap-3">
          {step < 4 ? (
            <button type="button" className="primary-button" onClick={() => setStep((current) => Math.min(current + 1, 4))}>
              Continue
              <ChevronRight className="h-4 w-4" />
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

function AuthorityPage({ dashboard, pendingAuthorities, onAction, onApprove }) {
  if (!dashboard) {
    return <div className="surface-card text-sm text-slate-400">Loading authority dashboard…</div>;
  }

  return (
    <section className="space-y-6">
      <div className="surface-card">
        <div className="section-kicker">Authority operations</div>
        <h2 className="font-display text-3xl text-white">{dashboard.parish} command view</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <SummaryCard label="Total active" value={String(dashboard.stats.totalActive)} />
          <SummaryCard label="Highest category" value={Object.entries(dashboard.stats.byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None'} />
          <SummaryCard label="Highest severity" value={Object.entries(dashboard.stats.bySeverity).sort((a, b) => b[1] - a[1])[0]?.[0] || 'None'} />
        </div>
      </div>

      <div className="surface-card">
        <div className="section-label mb-4">Jurisdiction incidents</div>
        <div className="space-y-3">
          {dashboard.incidents.map((incident) => (
            <div key={incident.id} className={`rounded-[28px] border p-4 ${incident.severity === 'high' || incident.severity === 'critical' || incident.credibility !== 'verified' ? 'border-amber-500/30 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <CategoryBadge category={incident.category} />
                    <SeverityBadge severity={incident.severity} />
                    <StatusBadge status={incident.status} />
                  </div>
                  <div className="text-lg font-semibold text-white">{incident.title}</div>
                  <div className="text-sm text-slate-400">
                    {formatAgo(incident.createdAt)} · {incident.confirmationCount} confirmations
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {['verify', 'respond', 'resolve', 'dismiss'].map((action) => (
                    <button key={action} className="ghost-button" onClick={() => onAction(incident.id, action, '')}>
                      {action}
                    </button>
                  ))}
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
                  <div className="text-sm text-slate-400">
                    {authority.organizationName} · {authority.badgeNumber}
                  </div>
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

function TrendsPage({ trendsBundle, onChangePeriod, onChangeParish }) {
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
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="field" value={trendsBundle.period} onChange={(event) => onChangePeriod(event.target.value)}>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
            <select className="field" value={trendsBundle.parish} onChange={(event) => onChangeParish(event.target.value)}>
              <option value="">All parishes</option>
              {PARISHES.map((parish) => (
                <option key={parish} value={parish}>
                  {parish}
                </option>
              ))}
            </select>
          </div>
        </div>
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

function ProfilePage({ bundle, activityBundle, onSave, onPreferencesSave, onAppeal }) {
  const [form, setForm] = useState({
    name: bundle?.user?.name || '',
    parish: bundle?.user?.parish || 'Kingston'
  });
  const [prefs, setPrefs] = useState(bundle?.user?.notificationPrefs || defaultPrefs);
  const [appeal, setAppeal] = useState({ strikeId: '', message: '' });

  useEffect(() => {
    setForm({
      name: bundle?.user?.name || '',
      parish: bundle?.user?.parish || 'Kingston'
    });
    setPrefs(bundle?.user?.notificationPrefs || defaultPrefs);
  }, [bundle?.user?.id, bundle?.user?.notificationPrefs, bundle?.user?.name, bundle?.user?.parish]);

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
                <option key={parish} value={parish}>
                  {parish}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" onClick={() => onSave(form)}>
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
                  <option key={severity} value={severity}>
                    {SEVERITY_META[severity].label}
                  </option>
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
          <button className="primary-button" onClick={() => onPreferencesSave(prefs)}>
            Save notification settings
          </button>
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
                <div className="text-sm text-slate-400">
                  {activity.action} · {formatAgo(activity.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="surface-card space-y-4">
          <div className="section-label">Strikes and appeals</div>
          <div className="space-y-3">
            {bundle.strikes.length ? bundle.strikes.map((strike) => (
              <label key={strike.id} className="flex items-start gap-3 rounded-[24px] border border-white/10 bg-white/5 px-4 py-3">
                <input
                  type="radio"
                  name="strikeId"
                  value={strike.id}
                  checked={appeal.strikeId === strike.id}
                  onChange={(event) => setAppeal((current) => ({ ...current, strikeId: event.target.value }))}
                />
                <div>
                  <div className="font-semibold text-white">{strike.reason}</div>
                  <div className="text-sm text-slate-400">{formatDateTime(strike.createdAt)}</div>
                </div>
              </label>
            )) : <div className="text-sm text-slate-400">No active strikes.</div>}
          </div>
          <textarea
            className="field min-h-24"
            placeholder="Submit a short appeal for the selected strike."
            value={appeal.message}
            onChange={(event) => setAppeal((current) => ({ ...current, message: event.target.value }))}
          />
          <button className="ghost-button" onClick={() => onAppeal(appeal)}>
            Submit appeal
          </button>
        </div>
      </div>
    </section>
  );
}

function ProtectedRoute({ children, user, requireAuthority = false }) {
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (requireAuthority && !(user.role === 'authority' || user.role === 'admin')) {
    return <Navigate to="/feed" replace />;
  }

  return children;
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
  const Icon = CATEGORY_META[category]?.icon || AlertTriangle;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">
      <Icon className={`h-4 w-4 ${CATEGORY_META[category]?.accent || 'text-white'}`} />
      {category}
    </span>
  );
}

function SeverityBadge({ severity }) {
  return <span className={`severity-pill ${SEVERITY_META[severity]?.chip}`}>{SEVERITY_META[severity]?.label || severity}</span>;
}

function StatusBadge({ status }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.18em] text-slate-300">
      {status.replaceAll('_', ' ')}
    </span>
  );
}

function HeatGrid({ points }) {
  const cells = Array.from({ length: 24 }, (_, index) => {
    const latBand = index % 6;
    const lngBand = Math.floor(index / 6);
    const total = points.filter((point) => {
      const x = Math.floor(((point.longitude - MAP_BOUNDS.lngMin) / (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin)) * 4);
      const y = Math.floor(((MAP_BOUNDS.latMax - point.latitude) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin)) * 6);
      return x === lngBand && y === latBand;
    }).reduce((sum, point) => sum + point.weight, 0);
    return total;
  });
  const max = Math.max(...cells, 1);

  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((value, index) => (
        <div
          key={index}
          className="aspect-[1.1/1] rounded-2xl border border-white/5"
          style={{
            background: `rgba(245, 158, 11, ${0.12 + (value / max) * 0.72})`
          }}
        />
      ))}
    </div>
  );
}

function projectPoint(latitude, longitude) {
  const left = ((longitude - MAP_BOUNDS.lngMin) / (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin)) * 100;
  const top = ((MAP_BOUNDS.latMax - latitude) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin)) * 100;
  return {
    left: clampNumber(left, 4, 96),
    top: clampNumber(top, 8, 92)
  };
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createStartTime(timeRange) {
  const now = Date.now();
  const offsets = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };

  return new Date(now - offsets[timeRange]).toISOString();
}

function formatAgo(dateString) {
  const diff = Date.now() - new Date(dateString).getTime();
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDateTime(dateString) {
  return new Intl.DateTimeFormat('en-JM', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(dateString));
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function withinJamaica(latitude, longitude) {
  return latitude >= MAP_BOUNDS.latMin && latitude <= MAP_BOUNDS.latMax && longitude >= MAP_BOUNDS.lngMin && longitude <= MAP_BOUNDS.lngMax;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function showBrowserNotification(notification, navigate) {
  if (!window.Notification || Notification.permission !== 'granted') {
    return;
  }

  const url = `/feed?incident=${notification.incidentId}`;
  if (navigator.serviceWorker?.ready) {
    const registration = await navigator.serviceWorker.ready;
    registration.showNotification(notification.title, {
      body: notification.body,
      data: { url }
    });
    return;
  }

  const browserNotification = new Notification(notification.title, {
    body: notification.body
  });
  browserNotification.onclick = () => {
    window.focus();
    navigate(url);
  };
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

export default App;
