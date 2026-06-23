/**
 * LoginPage — 3-tab login form with Claude-style design.
 *
 * Tabs: Admin, API Key, Temp Credential.
 * Each tab shows the appropriate form fields.
 * Error states with shake animation.
 */

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { TabBar } from '@/components/ui/TabBar';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Parse the URL hash fragment to extract share string and optional credential.
 *
 * URL format: /login#<shareString>[-<6-char-credential>]
 * Example:   /login#4821-XK7M-A3PQ-Z9WJ-B5NT-FK26-G8VE-N4PQ-A1B2C3
 *            shareString = "4821-XK7M-A3PQ-Z9WJ-B5NT-FK26-G8VE-N4PQ"
 *            credential  = "A1B2C3"
 *
 * Parsing: split at the last '-' character. If the suffix is exactly 6 chars
 * and alphanumeric, treat it as a credential code. Otherwise, the entire hash
 * is treated as the share string.
 */
function parseHash(hash: string): { shareString: string; credential: string | null } {
  // Strip leading '#' if present
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return { shareString: '', credential: null };

  // URL-decode the hash (it may have been encodeURIComponent'd by the QR generator)
  const decoded = decodeURIComponent(raw);

  const lastDash = decoded.lastIndexOf('-');
  if (lastDash === -1) {
    // No dash → entire string is share string
    return { shareString: decoded, credential: null };
  }

  const potentialCred = decoded.slice(lastDash + 1);
  const potentialShare = decoded.slice(0, lastDash);

  // Credential codes are always exactly 6 alphanumeric characters
  if (potentialCred.length === 6 && /^[A-Za-z0-9]{6}$/.test(potentialCred)) {
    return { shareString: potentialShare, credential: potentialCred.toUpperCase() };
  }

  // Last segment doesn't look like a credential → treat everything as share string
  return { shareString: decoded, credential: null };
}

type LoginTab = 'admin' | 'api_key' | 'temp_credential';

const tabs = [
  { key: 'admin', label: t('login.tabAdmin') },
  { key: 'api_key', label: t('login.tabApiKey') },
  { key: 'temp_credential', label: t('login.tabTemp') },
];

export function LoginPage() {
  const navigate = useNavigate();
  const login = useStore((s) => s.login);

  const [activeTab, setActiveTab] = useState<LoginTab>('admin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tempCode, setTempCode] = useState('');
  const [shareString, setShareString] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * Perform login with the given parameters.
   * Extracted from handleSubmit so that auto-login from URL hash
   * can reuse the same logic without simulating a form event.
   */
  const doLogin = useCallback(async (tab: LoginTab, params: Record<string, string>) => {
    setError('');
    setLoading(true);
    try {
      let response: Awaited<ReturnType<typeof api.login>>;
      switch (tab) {
        case 'admin':
          response = await api.login('admin', { username: params.username!, password: params.password! });
          break;
        case 'api_key':
          response = await api.login('api_key', { api_key: params.apiKey! });
          break;
        case 'temp_credential':
          response = await api.login('temp_credential', { temp_code: params.tempCode! });
          break;
      }

      login({
        token: response.token,
        accountType: response.account_type,
        scope: response.scope,
        expiresAt: response.expires_at,
      });

      // If manual login was preceded by a QR scan, persist the share string
      // so RoomListPage can pre-fill the join input after navigation.
      if (shareString) {
        useStore.getState().setPendingShareString(shareString);
      }

      navigate('/rooms');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('login.error');
      setError(message);
      throw err; // Re-throw for callers that need to know login failed
    } finally {
      setLoading(false);
    }
  }, [login, navigate, shareString]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      switch (activeTab) {
        case 'admin':
          await doLogin('admin', { username, password });
          break;
        case 'api_key':
          await doLogin('api_key', { apiKey });
          break;
        case 'temp_credential':
          await doLogin('temp_credential', { tempCode });
          break;
      }
    } catch {
      // Error already set by doLogin
    }
  };

  // ---- Hash parsing on mount (QR scan auto-login) ----
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return; // No hash → normal login flow

    const { shareString: parsedShare, credential } = parseHash(hash);

    // Persist the share string for post-login auto-fill in RoomListPage.
    // Set synchronously so it's available regardless of doLogin closure timing.
    if (parsedShare) {
      useStore.getState().setPendingShareString(parsedShare);
    }

    if (credential) {
      // Full login URL detected → auto-submit
      setTempCode(credential);
      setActiveTab('temp_credential');
      setShareString(parsedShare);

      // Auto-submit: small delay to ensure React state has settled
      // before the login call reads from the component scope.
      setTimeout(() => {
        doLogin('temp_credential', { tempCode: credential });
      }, 100);
    } else if (parsedShare) {
      // Share string only → pre-fill, prompt for credential
      setActiveTab('temp_credential');
      setShareString(parsedShare);
      // User manually enters credential code and submits
    }
    // If parsedShare is empty, do nothing (normal login flow)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount; hash won't change during SPA lifecycle

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-full max-w-md"
      >
        {/* Decorative mark */}
        <div className="flex justify-center mb-6">
          <svg
            className="w-8 h-8 text-ink"
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              d="M16 2L18 14L30 16L18 18L16 30L14 18L2 16L14 14L16 2Z"
              fill="currentColor"
            />
          </svg>
        </div>

        <Card padding="xl" className="max-w-md">
          <h1 className="text-display-md font-display text-ink text-center mb-2">
            filesync
          </h1>
          <p className="text-sm text-muted text-center mb-8">
            {t('login.subtitle')}
          </p>

          {/* Tabs */}
          <TabBar
            tabs={tabs}
            activeTab={activeTab}
            onChange={(key) => {
              setActiveTab(key as LoginTab);
              setError('');
            }}
            className="mb-6"
          />

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4"
              >
                <motion.div
                  animate={{ x: [0, -4, 4, -4, 4, 0] }}
                  transition={{ duration: 0.4 }}
                  className="p-3 bg-error/10 border border-error/30 rounded-md text-sm text-error"
                  role="alert"
                >
                  {error}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {activeTab === 'admin' && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col gap-4"
              >
                <Input
                  label={t('login.username')}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  required
                />
                <Input
                  label={t('login.password')}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
              </motion.div>
            )}

            {activeTab === 'api_key' && (
              <motion.div
                key="api_key"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Input
                  label={t('login.apiKey')}
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="32-character hex key"
                  autoComplete="off"
                  required
                />
              </motion.div>
            )}

            {activeTab === 'temp_credential' && (
              <motion.div
                key="temp"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Share string display — shown when extracted from URL hash */}
                {shareString && (
                  <div className="mb-4">
                    <label className="text-xs text-muted block mb-1">
                      {t('rooms.shareString')}
                    </label>
                    <code className="block w-full px-3 py-2 bg-canvas-card rounded-md text-xs font-mono text-body break-all select-all">
                      {shareString}
                    </code>
                  </div>
                )}
                <Input
                  label={t('login.tempCode')}
                  type="text"
                  value={tempCode}
                  onChange={(e) => setTempCode(e.target.value.toUpperCase())}
                  placeholder="A1B2C3"
                  maxLength={12}
                  autoComplete="off"
                  required
                  autoFocus={!!shareString}
                />
              </motion.div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              className="mt-2"
            >
              {t('login.button')}
            </Button>
          </form>
        </Card>
      </motion.div>
    </div>
  );
}
