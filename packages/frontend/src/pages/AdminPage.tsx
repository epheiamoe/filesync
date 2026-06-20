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
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import type { AdminStats } from '@shared/types';

export function AdminPage() {
  const navigate = useNavigate();
  const { session } = useStore();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingCred, setCreatingCred] = useState(false);
  const [newCredCode, setNewCredCode] = useState('');
  const [rooms, setRooms] = useState<Awaited<ReturnType<typeof api.getAdminRooms>>>([]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [s, r] = await Promise.all([
        api.getAdminStats(),
        api.getAdminRooms(),
      ]);
      setStats(s);
      setRooms(r);
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

  const handleDestroyRoom = async (roomCode: string) => {
    if (!window.confirm(t('admin.destroyConfirm'))) return;
    try {
      await api.destroyRoom(roomCode);
      await loadData();
    } catch {
      // ignore
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
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
