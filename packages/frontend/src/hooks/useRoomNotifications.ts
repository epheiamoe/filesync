/**
 * useRoomNotifications — Browser system notifications for room messages.
 *
 * Listens to the room WebSocket and shows a Notification when:
 * - the browser Notifications API is available and granted permission
 * - the page is in the background (document.visibilityState === 'hidden')
 * - the incoming event is a chat or file_shared message from another session
 *
 * The notification intentionally never includes message content because all
 * payloads are end-to-end encrypted; only the device label and message type
 * are exposed by the server broadcast.
 *
 * @module hooks/useRoomNotifications
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { t } from '@/i18n';
import { RoomSocket } from '@/lib/ws';
import type { WsMessage } from '@shared/types';

export type NotificationPermissionState = NotificationPermission | 'unsupported';

/**
 * Show a system notification, preferring the service worker path.
 *
 * Chrome on Android throws "Illegal constructor" for page-created
 * `new Notification(...)` — notifications there MUST go through
 * ServiceWorkerRegistration.showNotification(). This app registers a
 * service worker (vite-plugin-pwa), so the SW path is used whenever a
 * registration exists; the constructor is only a fallback for contexts
 * without a service worker (e.g. dev server before SW registration).
 * Clicks on SW notifications are handled by sw-notification-click.js.
 */
async function showNotification(title: string, options: NotificationOptions): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // SW unavailable or showNotification failed — fall through
  }

  const notification = new Notification(title, options);
  notification.onclick = () => {
    window.focus();
    if (typeof notification.close === 'function') {
      notification.close();
    }
  };
}

/**
 * React hook that wires a RoomSocket to the browser Notifications API.
 *
 * @param socket - The active RoomSocket, or null before connection.
 * @param currentSessionId - The current user's session token/id used to skip self-sent messages.
 * @returns An object with the current permission state and a function to request permission.
 */
export function useRoomNotifications(
  socket: RoomSocket | null,
  currentSessionId: string,
): {
  requestPermission: () => Promise<void>;
  permission: NotificationPermissionState;
} {
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  // Keep a live reference so the message handler always sees the latest permission
  // without re-subscribing to the socket every time the state changes.
  const permissionRef = useRef<NotificationPermissionState>(permission);
  useEffect(() => {
    permissionRef.current = permission;
  }, [permission]);

  /**
   * Request notification permission from the user.
   * Must be called in response to a user gesture (e.g. button click or after send).
   */
  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {
      // Some contexts (e.g. cross-origin iframes) may throw; ignore safely.
    }
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const unsubscribe = socket.onMessage((event: WsMessage) => {
      if (event.type !== 'chat' && event.type !== 'file_shared') return;
      if (event.sender_session_id === currentSessionId) return;
      if (typeof Notification === 'undefined') return;
      if (permissionRef.current !== 'granted') return;
      if (document.visibilityState !== 'hidden') return;

      // Map the wire event name to the user-facing message-type key.
      const messageTypeKey = event.type === 'chat' ? 'text' : 'file_shared';
      const device = event.device_label || 'Unknown';

      const title = t('notification.newMessage');
      const body = `${t('notification.fromDevice', { device })} · ${t(
        `notification.messageType.${messageTypeKey}`,
      )}`;

      showNotification(title, {
        body,
        icon: '/favicon.svg',
        data: { url: window.location.href },
      }).catch(() => {
        // Notifications may fail in insecure contexts; ignore.
      });
    });

    return () => {
      unsubscribe();
    };
  }, [socket, currentSessionId]);

  return { requestPermission, permission };
}
