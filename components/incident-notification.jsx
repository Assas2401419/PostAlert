'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CarFront,
  Clock3,
  CloudRain,
  MapPinned,
  Megaphone,
  ShieldAlert,
  Wrench,
  X
} from 'lucide-react';

import { useNotifications } from '../lib/notification-context.jsx';

const CATEGORY_ICONS = {
  Crime: ShieldAlert,
  Accident: CarFront,
  'Natural Disaster': CloudRain,
  Infrastructure: Wrench,
  'Community Alert': Megaphone
};

const SEVERITY_CONFIG = {
  low: {
    label: 'Low',
    className: 'notification-low'
  },
  medium: {
    label: 'Medium',
    className: 'notification-medium'
  },
  high: {
    label: 'High',
    className: 'notification-high'
  },
  critical: {
    label: 'Critical',
    className: 'notification-critical'
  }
};

function formatTimeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 10) {
    return 'Just now';
  }
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  return `${Math.floor(diffHours / 24)}d ago`;
}

function NotificationCard({
  notification,
  onDismiss,
  onPause,
  onResume,
  onViewDetails
}) {
  const { incident, isExiting, isPaused, remainingMs, startedAt, durationMs } = notification;
  const [progress, setProgress] = useState((remainingMs / durationMs) * 100);

  const severity = SEVERITY_CONFIG[incident.severity] || SEVERITY_CONFIG.medium;
  const CategoryIcon = CATEGORY_ICONS[incident.category] || AlertTriangle;
  const heading = `${severity.label} ${incident.subcategory || incident.category}`;
  const timeAgo = formatTimeAgo(incident.createdAt);

  useEffect(() => {
    if (isPaused || isExiting) {
      setProgress((remainingMs / durationMs) * 100);
      return undefined;
    }

    const updateProgress = () => {
      const elapsed = Date.now() - startedAt;
      const nextRemaining = Math.max(0, remainingMs - elapsed);
      setProgress((nextRemaining / durationMs) * 100);
    };

    updateProgress();
    const interval = window.setInterval(updateProgress, 50);
    return () => window.clearInterval(interval);
  }, [durationMs, isExiting, isPaused, remainingMs, startedAt]);

  return (
    <article
      className={`incident-notification ${severity.className} ${
        isExiting ? 'notification-exit' : 'notification-enter'
      }`}
      onMouseEnter={() => onPause(notification.id)}
      onMouseLeave={() => onResume(notification.id)}
    >
      <div className="notification-handle" />

      <div className="notification-header">
        <div className="notification-app-chip">
          <span className="notification-dot" />
          <span>PostAlert live alert</span>
        </div>
        <button
          aria-label="Dismiss notification"
          className="notification-close"
          onClick={() => onDismiss(notification.id)}
          type="button"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="notification-main">
        <div className="notification-icon-shell">
          <CategoryIcon aria-hidden="true" className="h-5 w-5" />
        </div>
        <div className="notification-body">
          <div className="notification-title-row">
            <div className="notification-eyebrow">{heading}</div>
            <div className="notification-time">
              <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
              <span>{timeAgo}</span>
            </div>
          </div>
          <div className="notification-summary">{incident.notificationTitle || incident.title}</div>
          <div className="notification-location">
            <MapPinned aria-hidden="true" className="h-4 w-4" />
            <span>{incident.address || `${incident.parish}, Jamaica`}</span>
          </div>
          {incident.description ? (
            <div className="notification-description">{incident.description}</div>
          ) : null}
        </div>
      </div>

      <div className="notification-footer">
        <div className="notification-meta">
          <span className="notification-meta-label">Reported by</span>
          <span>{incident.reporterName}</span>
          {incident.parish ? (
            <>
              <span className="notification-meta-divider" />
              <span>{incident.parish}</span>
            </>
          ) : null}
        </div>
        <button
          className="notification-button-primary"
          onClick={() => onViewDetails(incident.id)}
          type="button"
        >
          <span>Open report</span>
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div className="notification-progress-bar" title="Auto-dismisses after 8 seconds">
        <div
          className="notification-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>
    </article>
  );
}

export function NotificationContainer() {
  const router = useRouter();
  const {
    notifications,
    pauseNotification,
    removeNotification,
    resumeNotification
  } = useNotifications();

  if (!notifications.length) {
    return null;
  }

  return (
    <div
      aria-label="Incident notifications"
      aria-live="polite"
      className="notification-container"
    >
      {notifications.map((notification, index) => (
        <div
          key={notification.id}
          className="notification-wrapper"
          style={{ '--notification-index': index }}
        >
          <NotificationCard
            notification={notification}
            onDismiss={removeNotification}
            onPause={pauseNotification}
            onResume={resumeNotification}
            onViewDetails={(incidentId) => {
              removeNotification(notification.id);
              router.push(`/incidents/${incidentId}`);
            }}
          />
        </div>
      ))}
    </div>
  );
}

export default NotificationContainer;
