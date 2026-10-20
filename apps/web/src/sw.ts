/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// FRONTEND FE7: el app shell queda en caché y toda navegación cae a index.html sin red.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// FRONTEND FE6: la versión nueva se activa solo cuando la app lo pide (sin sesión en curso).
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});
clientsClaim();

/** `PushPayload` de @estudio/shared, leído sin zod para no cargarlo en el SW. */
interface PushPayload {
  readonly title: string;
  readonly body?: string;
  readonly tag?: string;
  readonly url?: string;
}

function parsePayload(data: PushMessageData | null): PushPayload {
  try {
    const value: unknown = data?.json();
    if (typeof value === 'object' && value !== null && 'title' in value && typeof value.title === 'string') {
      return value as PushPayload;
    }
  } catch {
    // Carga ilegible: igual se muestra una notificación (NT8).
  }
  return { title: 'Estudio' };
}

// NOTIFICATIONS NT8: cada push muestra una notificación; iOS revoca suscripciones silenciosas.
// El texto ya viene neutro desde el catálogo del servidor (NT6).
self.addEventListener('push', (event: PushEvent) => {
  const payload = parsePayload(event.data);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icon.svg',
      data: { url: payload.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const target = new URL(data?.url ?? '/', self.location.origin).href;
  // NT7: la URL de un recordatorio trae `?aviso=<id>`; la app reporta la apertura al cargar.
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        await existing.focus();
        await existing.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
