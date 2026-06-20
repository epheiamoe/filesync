/**
 * LoginPage — 3-tab login form with Claude-style design.
 *
 * Tabs: Admin, API Key, Temp Credential.
 * Each tab shows the appropriate form fields.
 * Error states with shake animation.
 */

import { useState, type FormEvent } from 'react';
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let response: Awaited<ReturnType<typeof api.login>>;

      switch (activeTab) {
        case 'admin':
          response = await api.login('admin', { username, password });
          break;
        case 'api_key':
          response = await api.login('api_key', { api_key: apiKey });
          break;
        case 'temp_credential':
          response = await api.login('temp_credential', { temp_code: tempCode });
          break;
      }

      login({
        token: response.token,
        accountType: response.account_type,
        scope: response.scope,
        expiresAt: response.expires_at,
      });

      navigate('/rooms');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('login.error');
      setError(message);
    } finally {
      setLoading(false);
    }
  };

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
            epheia-files
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
                <Input
                  label={t('login.tempCode')}
                  type="text"
                  value={tempCode}
                  onChange={(e) => setTempCode(e.target.value.toUpperCase())}
                  placeholder="A1B2C3"
                  maxLength={6}
                  autoComplete="off"
                  required
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
