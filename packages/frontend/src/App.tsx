/**
 * App.tsx — Root application component.
 *
 * Sets up:
 * - React Router with routes
 * - Auth guard (ProtectedRoute)
 * - PWA install prompt handler
 * - Theme initialization
 */

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useStore } from '@/lib/store';
import { initI18n } from '@/i18n';
import { parseDeviceLabel } from '@/lib/device';
import { setTokenGetter, setUnauthorizedHandler } from '@/lib/api';
import { LoginPage } from '@/pages/LoginPage';
import { RoomListPage } from '@/pages/RoomListPage';
import { RoomPage } from '@/pages/RoomPage';
import { AdminPage } from '@/pages/AdminPage';
import { ToastContainer } from '@/components/ui/Toast';

// Initialize i18n
initI18n();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore((s) => s.isAuthenticated);
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function OfflinePage() {
  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4 p-4">
      <svg
        className="w-16 h-16 text-muted-soft"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" />
      </svg>
      <h1 className="text-display-sm font-display text-ink">epheia-files</h1>
      <p className="text-sm text-muted">You are offline. Check your connection.</p>
    </div>
  );
}

export function App() {
  const { token, isAuthenticated, setDeviceLabel, logout } = useStore();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  // Setup API auth helpers
  useEffect(() => {
    setTokenGetter(() => token);
    setUnauthorizedHandler(() => logout());
  }, [token, logout]);

  // Detect device label
  useEffect(() => {
    setDeviceLabel(parseDeviceLabel());
  }, [setDeviceLabel]);

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('epheia_session');
      if (stored) {
        const session = JSON.parse(stored);
        if (session.token && session.accountType) {
          useStore.getState().login(session);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // PWA install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/offline" element={<OfflinePage />} />
          <Route
            path="/rooms"
            element={
              <ProtectedRoute>
                <RoomListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/room/:code"
            element={
              <ProtectedRoute>
                <RoomPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <AdminPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <Navigate to={isAuthenticated ? '/rooms' : '/login'} replace />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
      <ToastContainer />

      {/* PWA install prompt */}
      {installPrompt && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[1000]">
          <button
            onClick={async () => {
              await installPrompt.prompt();
              const result = await installPrompt.userChoice;
              if (result.outcome === 'accepted') {
                setInstallPrompt(null);
              }
            }}
            className="px-5 py-3 bg-primary text-on-primary rounded-lg text-sm font-medium shadow-lg hover:bg-primary-active"
          >
            Install App
          </button>
        </div>
      )}
    </BrowserRouter>
  );
}

// Type for beforeinstallprompt event
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
