/**
 * RoomListPage — Room list with create/join functionality.
 *
 * Shows existing rooms as cards with room_code, member count, and share options.
 * Allows creating new rooms (with QR code display) and joining via share string.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { generateRoomKey, encodeShareString, hashKey, storeRoomKey, decodeShareString } from '@/lib/crypto';
import { parseDeviceLabel } from '@/lib/device';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { QRShare } from '@/components/shared/QRShare';
import { Spinner } from '@/components/ui/Spinner';
import type { AdminRoomRow } from '@shared/types';

export function RoomListPage() {
  const navigate = useNavigate();
  const { session, logout } = useStore();
  const [rooms, setRooms] = useState<AdminRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [shareStringInput, setShareStringInput] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState({ shareString: '', roomCode: '' });

  const loadRooms = useCallback(async () => {
    try {
      setLoading(true);
      // If admin, get all rooms; otherwise we show rooms the user is member of
      if (session?.scope?.includes('admin')) {
        const data = await api.getAdminRooms();
        setRooms(data);
      } else {
        // Non-admin: try listing rooms (the endpoint returns accessible rooms)
        try {
          const data = await api.listRooms();
          setRooms(data);
        } catch {
          setRooms([]);
        }
      }
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const handleCreateRoom = async () => {
    setError('');
    setCreating(true);
    try {
      const key = generateRoomKey();
      const keyHash = await hashKey(key);
      const result = await api.createRoom(keyHash, customCode || undefined);

      // Store the room key
      storeRoomKey(result.room_code, key);

      // Generate share string
      const shareString = encodeShareString(result.room_code, key);

      setQrData({ shareString, roomCode: result.room_code });
      setQrOpen(true);
      setShowCreate(false);
      setCustomCode('');

      // Refresh room list
      await loadRooms();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.error');
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = async () => {
    setError('');
    setJoining(true);
    try {
      // Try to decode as share string first
      const decoded = decodeShareString(shareStringInput);
      if (!decoded) {
        // Try as plain room code + manual key
        if (shareStringInput.length !== 4) {
          setError(t('rooms.roomNotFound'));
          return;
        }
        // We need a key — but user must provide it somehow.
        // For now, assume the input is a share string.
        setError(t('rooms.keyMismatch'));
        return;
      }

      const { roomCode, key } = decoded;
      const keyHash = await hashKey(key);
      const deviceLabel = parseDeviceLabel();

      await api.joinRoom(roomCode, keyHash, deviceLabel);

      // Store the key
      storeRoomKey(roomCode, key);

      // Navigate to room
      navigate(`/room/${roomCode}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('rooms.keyMismatch');
      setError(message);
    } finally {
      setJoining(false);
    }
  };

  const handleRoomClick = (roomCode: string) => {
    navigate(`/room/${roomCode}`);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    logout();
    navigate('/login');
  };

  const isAdmin = session?.scope?.includes('admin');

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-canvas/80 backdrop-blur-sm border-b border-hairline">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-display-sm font-display text-ink">epheia-files</h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">{session?.accountType}</span>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/admin')}
              >
                {t('admin.title')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
            >
              {t('logout.button')}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <Button
            variant="primary"
            size="lg"
            onClick={() => setShowCreate(!showCreate)}
          >
            + {t('rooms.create')}
          </Button>

          {/* Join section */}
          <div className="flex-1 flex gap-2">
            <Input
              value={shareStringInput}
              onChange={(e) => setShareStringInput(e.target.value)}
              placeholder={t('rooms.shareKeyPlaceholder')}
              className="flex-1"
              aria-label={t('rooms.shareKey')}
            />
            <Button
              variant="secondary"
              size="lg"
              loading={joining}
              onClick={handleJoinRoom}
            >
              {t('rooms.join')}
            </Button>
          </div>
        </div>

        {/* Create form */}
        <AnimatePresence>
          {showCreate && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-8 overflow-hidden"
            >
              <Card padding="lg">
                <h2 className="text-title-md font-display text-ink mb-4">
                  {t('rooms.create')}
                </h2>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value)}
                    placeholder={t('rooms.customCode')}
                    maxLength={4}
                    className="sm:w-48"
                    aria-label={t('rooms.customCode')}
                  />
                  <Button
                    variant="primary"
                    loading={creating}
                    onClick={handleCreateRoom}
                  >
                    {t('rooms.create')}
                  </Button>
                </div>
                {error && (
                  <p className="text-sm text-error mt-3" role="alert">{error}</p>
                )}
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Room list */}
        <h2 className="text-title-md font-display text-ink mb-4">{t('rooms.title')}</h2>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        ) : rooms.length === 0 ? (
          <EmptyState message={t('rooms.noRooms')} />
        ) : (
          <motion.div
            className="grid gap-3 sm:grid-cols-2"
            initial="hidden"
            animate="visible"
            variants={{
              visible: { transition: { staggerChildren: 0.05 } },
            }}
          >
            {rooms.map((room) => (
              <motion.div
                key={room.id}
                variants={{
                  hidden: { opacity: 0, y: 10 },
                  visible: {
                    opacity: 1,
                    y: 0,
                    transition: { type: 'spring', stiffness: 500, damping: 40 },
                  },
                }}
              >
                <Card
                  padding="md"
                  className="cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => handleRoomClick(room.room_code)}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                >
                  <div className="flex items-center justify-between">
                    <code className="text-display-sm font-display text-ink">
                      {room.room_code}
                    </code>
                    <span className="text-xs text-muted">
                      {room.member_count} {t('rooms.members')}
                      {room.file_count !== undefined && (
                        <> · {room.file_count} {t('rooms.files')}</>
                      )}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-muted-soft">
                    {t('rooms.created')}: {new Date(room.created_at).toLocaleDateString()}
                  </div>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>

      {/* QR Share Modal */}
      <QRShare
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        shareString={qrData.shareString}
        roomCode={qrData.roomCode}
      />
    </div>
  );
}
