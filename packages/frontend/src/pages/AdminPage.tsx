/**
 * AdminPage — Admin dashboard with stats, credential management, and room management.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import type { AdminStats, ApiKeyListItem } from '@shared/types';

export function AdminPage() {
  const navigate = useNavigate();
  const { session } = useStore();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingCred, setCreatingCred] = useState(false);
  const [newCredCode, setNewCredCode] = useState('');
  const [rooms, setRooms] = useState<Awaited<ReturnType<typeof api.getAdminRooms>>>([]);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwChanging, setPwChanging] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwOk, setPwOk] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [apiKeys, setApiKeys] = useState<ApiKeyListItem[]>([]);
  const [apiKeyLabel, setApiKeyLabel] = useState('');
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [newApiKey, setNewApiKey] = useState<{ key: string; label: string } | null>(null);
  const [copying, setCopying] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [keyToDelete, setKeyToDelete] = useState<ApiKeyListItem | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
  const [prefixCopied, setPrefixCopied] = useState(false);
  const addToast = useStore((s) => s.addToast);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [s, r, keys] = await Promise.all([
        api.getAdminStats(),
        api.getAdminRooms(),
        api.listApiKeys(),
      ]);
      setStats(s);
      setRooms(r);
      setApiKeys(keys);
    } catch {
      // error handled by UI
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateCredential = async () => {
    setCreatingCred(true);
    try {
      const result = await api.createTempCredential();
      setNewCredCode(result.code);
    } catch {
      // ignore
    } finally {
      setCreatingCred(false);
    }
  };

  const handleCreateApiKey = async () => {
    if (!apiKeyLabel.trim()) return;
    setCreatingApiKey(true);
    try {
      const result = await api.createApiKey(apiKeyLabel.trim());
      setNewApiKey({ key: result.key, label: result.label ?? apiKeyLabel.trim() });
      setApiKeyLabel('');
      await loadData();
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setCreatingApiKey(false);
    }
  };

  const handleCopyApiKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopying(true);
      setTimeout(() => setCopying(false), 1500);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  };

  const openDeleteDialog = useCallback((key: ApiKeyListItem) => {
    setKeyToDelete(key);
    setDeleteConfirmInput('');
    setPrefixCopied(false);
    setDeleteDialogOpen(true);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteDialogOpen(false);
  }, []);

  const handleCopyPrefix = useCallback(async (prefix: string) => {
    try {
      await navigator.clipboard.writeText(prefix);
      setPrefixCopied(true);
      setTimeout(() => setPrefixCopied(false), 1500);
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [addToast]);

  const handleConfirmDelete = useCallback(async () => {
    if (!keyToDelete || deleteConfirmInput !== keyToDelete.api_key_prefix) return;
    setDeleteDialogOpen(false);
    try {
      await api.deleteApiKey(keyToDelete.key_hash);
      await loadData();
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setKeyToDelete(null);
      setDeleteConfirmInput('');
    }
  }, [keyToDelete, deleteConfirmInput, loadData, addToast]);

  const handleDestroyRoom = async (roomCode: string) => {
    if (!window.confirm(t('admin.destroyConfirm'))) return;
    try {
      await api.destroyRoom(roomCode);
      await loadData();
    } catch {
      // ignore
    }
  };

  const handleChangePassword = async () => {
    if (!pwCurrent || !pwNew || pwNew.length < 8) {
      setPwMsg(t('admin.pwTooShort'));
      return;
    }
    setPwChanging(true);
    setPwMsg('');
    setPwOk(false);
    try {
      await api.changePassword(pwCurrent, pwNew);
      setPwMsg(t('admin.pwChanged'));
      setPwOk(true);
      setPwCurrent('');
      setPwNew('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('common.error');
      setPwMsg(msg);
    } finally {
      setPwChanging(false);
    }
  };

  // Delete all rooms with double confirmation
  const handleDeleteAllRooms = async () => {
    // First confirmation: standard confirm dialog
    if (!window.confirm(t('admin.deleteAllConfirm'))) return;

    // Second confirmation: prompt to type DELETE
    const input = window.prompt(t('admin.typeDelete'));
    if (input !== 'DELETE') {
      if (input !== null) {
        addToast({ type: 'error', message: t('admin.typeDelete') });
      }
      return;
    }

    setDeletingAll(true);
    try {
      const result = await api.destroyAllRooms();
      addToast({
        type: 'info',
        message: t('admin.deleteAllDone', { count: String(result.deleted_rooms ?? 0) }),
      });
      await loadData();
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    } finally {
      setDeletingAll(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${bytes} B`;
  };

  if (!session?.scope?.includes('admin')) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-4">
        <p className="text-error">Access denied</p>
        <Button variant="secondary" onClick={() => navigate('/rooms')}>
          {t('common.back')}
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 bg-canvas/80 backdrop-blur-sm border-b border-hairline">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-display-sm font-display text-ink">{t('admin.title')}</h1>
          <Button variant="ghost" size="sm" onClick={() => navigate('/rooms')}>
            {t('common.back')}
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {/* Stats */}
            <section>
              <h2 className="text-title-md font-display text-ink mb-4">{t('admin.stats')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card padding="md">
                  <p className="text-xs text-muted mb-1">{t('admin.r2Usage')}</p>
                  <p className="text-title-md font-display text-ink">
                    {stats ? formatBytes(stats.r2_total_bytes) : '—'}
                  </p>
                </Card>
                <Card padding="md">
                  <p className="text-xs text-muted mb-1">{t('admin.fileCount')}</p>
                  <p className="text-title-md font-display text-ink">
                    {stats?.r2_file_count ?? '—'}
                  </p>
                </Card>
                <Card padding="md">
                  <p className="text-xs text-muted mb-1">{t('admin.roomCount')}</p>
                  <p className="text-title-md font-display text-ink">
                    {stats?.room_count ?? '—'}
                  </p>
                </Card>
                <Card padding="md">
                  <p className="text-xs text-muted mb-1">{t('admin.activeSessions')}</p>
                  <p className="text-title-md font-display text-ink">
                    {stats?.active_sessions ?? '—'}
                  </p>
                </Card>
              </div>
            </section>

            {/* Create Credential */}
            <section>
              <h2 className="text-title-md font-display text-ink mb-4">{t('admin.credentials')}</h2>
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <Button
                  variant="primary"
                  loading={creatingCred}
                  onClick={handleCreateCredential}
                >
                  {t('admin.createCredential')}
                </Button>
                {newCredCode && (
                  <motion.code
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="px-4 py-2 bg-canvas-card rounded-md text-lg font-mono text-ink"
                  >
                    {newCredCode}
                  </motion.code>
                )}
              </div>
            </section>

            {/* API Key Management */}
            <section>
              <h2 className="text-title-md font-display text-ink mb-4">{t('admin.apiKeys')}</h2>
              <Card padding="md" className="max-w-2xl">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                    <div className="flex-1 w-full">
                      <Input
                        value={apiKeyLabel}
                        onChange={(e) => setApiKeyLabel(e.target.value)}
                        placeholder={t('admin.apiKeyLabelPlaceholder')}
                        aria-label={t('admin.apiKeyLabel')}
                      />
                    </div>
                    <Button
                      variant="primary"
                      loading={creatingApiKey}
                      onClick={handleCreateApiKey}
                      disabled={!apiKeyLabel.trim() || creatingApiKey}
                      icon={
                        <svg
                          className="w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M15.236 11.395a4 4 0 1 0-6.472 0A4 4 0 0 0 5 15c0 1.657 1.343 3 3 3h8c1.657 0 3-1.343 3-3a4 4 0 0 0-3.764-3.605Z" />
                          <path d="M12 22v-5" />
                          <path d="M9 17h6" />
                        </svg>
                      }
                    >
                      {t('admin.createApiKey')}
                    </Button>
                  </div>

                  {newApiKey && (
                    <div className="p-4 bg-success/10 border border-success/20 rounded-md">
                      <p className="text-sm text-success mb-2">{t('admin.apiKeyCreated')}</p>
                      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                        <code className="flex-1 px-3 py-2 bg-canvas rounded-md font-mono text-ink break-all text-sm">
                          {newApiKey.key}
                        </code>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleCopyApiKey(newApiKey.key)}
                          icon={
                            copying ? (
                              <svg
                                className="w-4 h-4"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg
                                className="w-4 h-4"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )
                          }
                          aria-label={copying ? t('admin.apiKeyCopied') : t('admin.apiKeyCopy')}
                        >
                          {copying ? t('admin.apiKeyCopied') : t('common.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div>
                    {apiKeys.length === 0 ? (
                      <p className="text-sm text-muted">{t('admin.apiKeyEmpty')}</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {apiKeys.map((key) => {
                          return (
                            <Card key={key.id} padding="sm" variant="flat">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                                  <span className="font-medium text-ink text-sm">
                                    {key.label || '—'}
                                  </span>
                                  <code className="text-xs text-muted font-mono">
                                    {t('admin.apiKeyPrefix')}: {key.api_key_prefix}
                                  </code>
                                  <Badge variant="success">
                                    {t('admin.apiKeyActive')}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs text-muted">
                                    {new Date(key.created_at).toLocaleString()}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openDeleteDialog(key)}
                                    className={`
                                      inline-flex items-center justify-center p-2 rounded-md
                                      transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-primary
                                      text-error hover:bg-error/10
                                    `.trim().replace(/\s+/g, ' ')}
                                    aria-label={t('admin.apiKeyDelete')}
                                  >
                                    <svg
                                      className="w-4 h-4"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      aria-hidden="true"
                                    >
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                      <line x1="10" y1="11" x2="10" y2="17" />
                                      <line x1="14" y1="11" x2="14" y2="17" />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </section>

            {/* Change Password */}
            <section>
              <h2 className="text-title-md font-display text-ink mb-4">{t('admin.changePassword')}</h2>
              <Card padding="md" className="max-w-md">
                <div className="flex flex-col gap-3">
                  <Input
                    type="password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    placeholder={t('admin.currentPassword')}
                  />
                  <Input
                    type="password"
                    value={pwNew}
                    onChange={(e) => setPwNew(e.target.value)}
                    placeholder={t('admin.newPassword')}
                  />
                  <Button
                    variant="primary"
                    loading={pwChanging}
                    onClick={handleChangePassword}
                  >
                    {t('admin.changePassword')}
                  </Button>
                  {pwMsg && (
                    <p className={`text-sm ${pwOk ? 'text-success' : 'text-error'}`} role="alert">
                      {pwMsg}
                    </p>
                  )}
                </div>
              </Card>
            </section>

            {/* Rooms */}
            <section>
              <h2 className="text-title-md font-display text-ink mb-4">{t('admin.roomManagement')}</h2>
              {rooms.length === 0 ? (
                <p className="text-sm text-muted">{t('common.empty')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {rooms.map((room) => (
                    <Card key={room.id} padding="md">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          <code className="text-title-sm font-display text-ink">
                            {room.room_code}
                          </code>
                          <Badge variant="default">
                            {room.member_count} {t('rooms.members')}
                          </Badge>
                          <span className="text-xs text-muted">
                            {room.file_count} files · {formatBytes(room.total_bytes)}
                          </span>
                        </div>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDestroyRoom(room.room_code)}
                        >
                          {t('admin.destroyRoom')}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Delete All Rooms button — always visible (Bug Fix 4B) */}
              <div className="mt-4 pt-4 border-t border-hairline">
                <Button
                  variant="danger"
                  loading={deletingAll}
                  onClick={handleDeleteAllRooms}
                  className="w-full sm:w-auto"
                  aria-label={t('admin.deleteAll')}
                >
                  <svg
                    className="w-4 h-4 mr-1.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                  {t('admin.deleteAll')}
                </Button>
                <p className="text-[11px] text-muted-soft mt-1.5">
                  {t('admin.deleteAllConfirm')}
                </p>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Delete API key confirmation dialog */}
      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={closeDeleteDialog}
        onConfirm={handleConfirmDelete}
        title={t('admin.apiKeyDeleteTitle')}
        description={
          keyToDelete ? (
            <div className="flex flex-col gap-3"
            >
              <p>{t('admin.apiKeyDeleteDescription', { label: keyToDelete.label || '—', prefix: keyToDelete.api_key_prefix })}</p>
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 bg-canvas-card rounded font-mono text-sm text-ink">
                  {keyToDelete.api_key_prefix}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopyPrefix(keyToDelete.api_key_prefix)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-canvas-card text-body hover:bg-primary/10 hover:text-primary transition-colors"
                  aria-label={prefixCopied ? t('admin.apiKeyDeletePrefixCopied') : t('admin.apiKeyDeletePrefixCopy')}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {prefixCopied ? (
                      <polyline points="20 6 9 17 4 12" />
                    ) : (
                      <>
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </>
                    )}
                  </svg>
                  {prefixCopied ? t('admin.apiKeyDeletePrefixCopied') : t('admin.apiKeyDeletePrefixCopy')}
                </button>
              </div>
              <p>{t('admin.apiKeyDeleteConfirm')}</p>
            </div>
          ) : null
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        danger
        confirmDisabled={!keyToDelete || deleteConfirmInput !== keyToDelete.api_key_prefix}
      >
        {keyToDelete && (
          <Input
            value={deleteConfirmInput}
            onChange={(e) => setDeleteConfirmInput(e.target.value)}
            placeholder={t('admin.apiKeyDeletePrefixPlaceholder')}
            aria-label={t('admin.apiKeyDeletePrefixHint')}
            error={
              deleteConfirmInput.length > 0 && deleteConfirmInput !== keyToDelete.api_key_prefix
                ? t('admin.apiKeyDeletePrefixMismatch')
                : undefined
            }
            autoFocus
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
