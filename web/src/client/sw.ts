/// <reference no-default-lib="true" />
/// <reference lib="es2020" />
/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
export {};

// Version for cache busting
const CACHE_VERSION = 'v1';
const CACHE_NAME = `vibetunnel-${CACHE_VERSION}`;

// Notification tag prefix for VibeTunnel notifications
const NOTIFICATION_TAG_PREFIX = 'vibetunnel-';

// Types for push notification payloads
interface SessionExitData {
  type: 'session-exit';
  sessionId: string;
  sessionName?: string;
  command?: string;
  exitCode: number;
  duration?: number;
  timestamp: number;
}

interface SessionStartData {
  type: 'session-start';
  sessionId: string;
  sessionName?: string;
  command?: string;
  timestamp: number;
}

interface SessionErrorData {
  type: 'session-error';
  sessionId: string;
  sessionName?: string;
  command?: string;
  error: string;
  timestamp: number;
}

interface SystemAlertData {
  type: 'system-alert';
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp: number;
}

type NotificationData = SessionExitData | SessionStartData | SessionErrorData | SystemAlertData;

interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data: NotificationData;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  tag?: string;
  requireInteraction?: boolean;
}

// Install event - cache essential resources
self.addEventListener('install', (event: ExtendableEvent) => {
  console.log('[SW] Installing service worker');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache essential resources for offline functionality
      return cache
        .addAll(['/', '/favicon.ico', '/apple-touch-icon.png', '/manifest.json'])
        .catch((error) => {
          // Don't fail installation if caching fails
          console.warn('[SW] Cache preload failed:', error);
        });
    })
  );

  // Force activation of new service worker
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', (event: ExtendableEvent) => {
  console.log('[SW] Activating service worker');

  event.waitUntil(
    Promise.all([
      // Cleanup old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith('vibetunnel-') && cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        );
      }),
      // Take control of all pages
      self.clients.claim(),
    ])
  );
});

// Push event - handle incoming push notifications
self.addEventListener('push', (event: PushEvent) => {
  console.log('[SW] Push event received');

  if (!event.data) {
    console.warn('[SW] Push event has no data');
    return;
  }

  let payload: PushNotificationPayload;

  try {
    payload = event.data.json();
  } catch (error) {
    console.error('[SW] Failed to parse push payload:', error);
    return;
  }

  event.waitUntil(handlePushNotification(payload));
});

// Notification click event - handle user interactions
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  console.log('[SW] Notification clicked:', event.notification.tag);

  event.notification.close();

  const data = event.notification.data as NotificationData;

  event.waitUntil(handleNotificationClick(event.action, data));
});

// Notification close event - track dismissals
self.addEventListener('notificationclose', (event: NotificationEvent) => {
  console.log('[SW] Notification closed:', event.notification.tag);

  const data = event.notification.data as NotificationData;

  // Optional: Send analytics or cleanup
  if (data.type === 'session-exit' || data.type === 'session-error') {
    // Could track notification dismissal metrics
  }
});

// Background sync event - handle offline notifications
self.addEventListener('sync', ((event: ExtendableEvent & { tag: string }) => {
  if (event.tag === 'notification-sync') {
    event.waitUntil(syncOfflineNotifications());
  }
}) as EventListener);

async function handlePushNotification(payload: PushNotificationPayload): Promise<void> {
  const { title, body, icon, badge, data, actions, tag, requireInteraction } = payload;

  try {
    // Create notification options
    const notificationOptions: NotificationOptions = {
      body,
      icon: icon || '/apple-touch-icon.png',
      badge: badge || '/favicon-32.png',
      data,
      tag: tag || `${NOTIFICATION_TAG_PREFIX}${data.type}-${Date.now()}`,
      requireInteraction: requireInteraction || data.type === 'session-error',
      silent: false,
      // @ts-ignore - renotify is a valid option but not in TypeScript types
      renotify: true,
      actions: actions || getDefaultActions(data),
      timestamp: data.timestamp,
    };

    // Add vibration pattern for mobile devices
    if ('vibrate' in navigator) {
      // @ts-ignore - vibrate is a valid option but not in TypeScript types
      notificationOptions.vibrate = getVibrationPattern(data.type);
    }

    // Show the notification
    await self.registration.showNotification(title, notificationOptions);

    console.log('[SW] Notification shown:', title);
  } catch (error) {
    console.error('[SW] Failed to show notification:', error);
  }
}

function getDefaultActions(data: NotificationData): any[] {
  const baseActions: any[] = [
    {
      action: 'dismiss',
      title: 'Dismiss',
    },
  ];

  switch (data.type) {
    case 'session-exit':
    case 'session-error':
    case 'session-start': {
      return [
        {
          action: 'view-session',
          title: 'View Session',
        },
        ...baseActions,
      ];
    }
    case 'system-alert': {
      return [
        {
          action: 'view-logs',
          title: 'View Logs',
        },
        ...baseActions,
      ];
    }
    default:
      return baseActions;
  }
}

function getVibrationPattern(notificationType: string): number[] {
  switch (notificationType) {
    case 'session-error':
      return [200, 100, 200, 100, 200]; // Urgent pattern
    case 'session-exit':
      return [100, 50, 100]; // Short notification
    case 'session-start':
      return [50]; // Very brief
    case 'system-alert':
      return [150, 75, 150]; // Moderate pattern
    default:
      return [100]; // Default brief vibration
  }
}

async function handleNotificationClick(action: string, data: NotificationData): Promise<void> {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  // Try to focus existing window first
  for (const client of clients) {
    if (client.url.includes(self.location.origin)) {
      try {
        await client.focus();

        // Send action to the client
        client.postMessage({
          type: 'notification-action',
          action,
          data,
        });

        return;
      } catch (error) {
        console.warn('[SW] Failed to focus client:', error);
      }
    }
  }

  // No existing window, open a new one
  let url = self.location.origin;

  switch (action) {
    case 'view-session': {
      if (
        data.type === 'session-exit' ||
        data.type === 'session-error' ||
        data.type === 'session-start'
      ) {
        url += `/?session=${data.sessionId}`;
      }
      break;
    }
    case 'view-logs': {
      url += '/logs';
      break;
    }
    default:
      // Just open the main page
      break;
  }

  try {
    await self.clients.openWindow(url);
  } catch (error) {
    console.error('[SW] Failed to open window:', error);
  }
}

async function syncOfflineNotifications(): Promise<void> {
  console.log('[SW] Syncing offline notifications');

  try {
    // Get pending notifications from IndexedDB or cache
    const pendingNotifications = await getPendingNotifications();

    for (const notification of pendingNotifications) {
      await handlePushNotification(notification);
    }

    // Clear pending notifications
    await clearPendingNotifications();

    console.log('[SW] Offline notification sync completed');
  } catch (error) {
    console.error('[SW] Failed to sync offline notifications:', error);
  }
}

async function getPendingNotifications(): Promise<PushNotificationPayload[]> {
  // This would typically use IndexedDB to store offline notifications
  // For now, return empty array as placeholder
  return [];
}

async function clearPendingNotifications(): Promise<void> {
  // Clear stored offline notifications
  // Placeholder for IndexedDB cleanup
}

// Handle fetch events for offline caching
self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!request.url.startsWith('http')) {
    return;
  }

  // Handle API requests differently
  if (request.url.includes('/api/')) {
    // Don't cache API requests, but could implement offline fallback
    return;
  }

  // Cache-first strategy for static assets
  if (request.url.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$/)) {
    event.respondWith(
      caches.match(request).then((response) => {
        if (response) {
          return response;
        }

        return fetch(request).then((response) => {
          // Don't cache non-successful responses
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Clone the response for caching
          const responseToCache = response.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });

          return response;
        });
      })
    );
  }
});

// Message handler for communication with main thread
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const { data } = event;

  switch (data.type) {
    case 'QUEUE_NOTIFICATION': {
      // Queue notification for later delivery when online
      queueNotification(data.payload);
      break;
    }
    case 'CLEAR_NOTIFICATIONS': {
      // Clear all VibeTunnel notifications
      clearAllNotifications();
      break;
    }
    case 'SKIP_WAITING': {
      self.skipWaiting();
      break;
    }
  }
});

async function queueNotification(payload: PushNotificationPayload): Promise<void> {
  // Store notification for offline sync
  // This would typically use IndexedDB
  console.log('[SW] Queueing notification for offline sync:', payload.title);

  // Register for background sync
  try {
    // @ts-ignore - sync is part of Background Sync API
    await self.registration.sync.register('notification-sync');
  } catch (error) {
    console.warn('[SW] Background sync not supported:', error);
  }
}

async function clearAllNotifications(): Promise<void> {
  try {
    const notifications = await self.registration.getNotifications();

    for (const notification of notifications) {
      if (notification.tag && notification.tag.startsWith(NOTIFICATION_TAG_PREFIX)) {
        notification.close();
      }
    }

    console.log('[SW] Cleared all VibeTunnel notifications');
  } catch (error) {
    console.error('[SW] Failed to clear notifications:', error);
  }
}

console.log('[SW] Service worker loaded');
