/**
 * RoomListPage — Room list with create/join functionality.
 *
 * Shows existing rooms as cards with room_code, member count, and share options.
 * Allows creating new rooms (with QR code display) and joining via share string.
 * Admin users can delete individual rooms with confirmation dialog.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { generateRoomKey, encodeShareString, hashKey, storeRoomKey, decodeShareString, hasRoomKey, getOrCreateClientFingerprint } from '@/lib/crypto';
import { parseDeviceLabel } from '@/lib/device';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { QRShare } from '@/components/shared/QRShare';
import { Spinner } from '@/components/ui/Spinner';
import type { AdminRoomRow, RoomInfo } from '@shared/types';

export function RoomListPage() {
  const navigate = useNavigate();
  const { session, logout } = useStore();
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [shareStringInput, setShareStringInput] = useState(() => {
    // If user arrived via QR scan auto-login, pre-populate the share string
    const pending = useStore.getState().pendingShareString;
    if (pending) {
      // Clear after reading (one-time use)
      setTimeout(() => useStore.getState().setPendingShareString(null), 0);
      return pending;
    }
    return '';
  });
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState({ shareString: '', roomCode: '' });
  const [deletingRooms, setDeletingRooms] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const addToast = useStore((s) => s.addToast);

  const loadRooms = useCallback(async () => {
    try {
      setLoading(true);
      // If admin, get all rooms; otherwise we show rooms the user is member of
      if (session?.scope?.includes('admin')) {
        const data = await api.getAdminRooms();
        setRooms(data);
      } else {
        // Non-admin: send client fingerprint for cross-session room lookup
        try {
          const fingerprint = getOrCreateClientFingerprint();
          const data = await api.listRooms(fingerprint);
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

      // Auto-join the room immediately after creation
      const deviceLabel = parseDeviceLabel();
      await api.joinRoom(result.room_code, keyHash, deviceLabel);

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

  // ---- QR Scanner ----

  const handleScanQR = async () => {
    setScanning(true);
    setScanError('');
    scanningRef.current = true;

    const stopScanning = () => {
      scanningRef.current = false;
      setScanning(false);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };

    // Helper: extract share string from scanned content
    const processScanResult = (content: string) => {
      // Try to find login#<shareString>[-<credential>] pattern
      const loginMatch = content.match(/login#(.+)/);
      if (loginMatch) {
        const fragment = decodeURIComponent(loginMatch[1]);
        stopScanning();
        navigate(`/login#${encodeURIComponent(fragment)}`);
        return true;
      }
      // Direct share string format: "4821-XXXX-XXXX-..."
      if (/^\d{4}-[0-9A-HJKMNP-TV-Z]+(-[0-9A-HJKMNP-TV-Z]+)*$/i.test(content)) {
        stopScanning();
        navigate(`/login#${encodeURIComponent(content)}`);
        return true;
      }
      return false;
    };

    // ---- Path A: BarcodeDetector API (Chrome/Edge) ----
    const BarcodeDetectorCtor = (window as unknown as Record<string, unknown>).BarcodeDetector;
    if (typeof BarcodeDetectorCtor === 'function') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const detector = new (BarcodeDetectorCtor as new (opts: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
        })({ formats: ['qr_code'] });

        const scanFrame = async () => {
          if (!videoRef.current || !scanningRef.current) return;
          try {
            const barcodes = await detector.detect(videoRef.current);
            for (const barcode of barcodes) {
              if (processScanResult(barcode.rawValue)) return;
            }
          } catch {
            // Detection error on a single frame — continue scanning
          }
          if (scanningRef.current) {
            requestAnimationFrame(scanFrame);
          }
        };
        scanFrame();
        return;
      } catch {
        // Camera access denied or BarcodeDetector failed → fall through to Path B
        stopScanning();
      }
    }

    // ---- Path B: File picker fallback ----
    // BarcodeDetector not supported or camera denied — use file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        setScanning(false);
        return;
      }
      try {
        // Use dynamic import of jsqr for fallback
        const jsQRModule = await import('jsqr').catch(() => null);
        const jsQR = jsQRModule?.default;
        if (!jsQR) {
          setScanError(t('rooms.scanCameraDenied'));
          setScanning(false);
          return;
        }
        const bitmap = await createImageBitmap(file);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setScanError(t('rooms.scanCameraDenied'));
          setScanning(false);
          return;
        }
        ctx.drawImage(bitmap, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code && processScanResult(code.data)) {
          return;
        }
        setScanError(t('rooms.scanCameraDenied'));
      } catch {
        setScanError(t('rooms.scanCameraDenied'));
      }
      setScanning(false);
    };
    fileInput.click();
  };

  const handleJoinRoom = async () => {
    setError('');
    setJoining(true);
    try {
      // Try to decode as share string first
      const decoded = decodeShareString(shareStringInput);
      if (!decoded) {
        // Check if this is the old 4-group (16-char) format
        const clean = shareStringInput.trim().replace(/\s/g, '');
        const dashIdx = clean.indexOf('-');
        const keyPart = dashIdx > 0 ? clean.slice(dashIdx + 1).replace(/-/g, '') : '';
        if (keyPart.length === 16) {
          setError(t('rooms.oldFormatDeprecated'));
          setJoining(false);
          return;
        }
        // Try as plain room code + manual key
        if (shareStringInput.length !== 4) {
          setError(t('rooms.roomNotFound'));
        } else {
          setError(t('rooms.keyMismatch'));
        }
        setJoining(false);
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

  // Delete a single room (admin only)
  const handleDeleteRoom = useCallback(async (roomCode: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent navigating to room

    if (!window.confirm(t('rooms.deleteConfirm'))) return;

    try {
      await api.destroyRoom(roomCode);
      // Start deleting animation
      setDeletingRooms((prev) => {
        const next = new Set(prev);
        next.add(roomCode);
        return next;
      });
      // Remove from list after animation
      setTimeout(() => {
        setRooms((prev) => prev.filter((r) => 'room_code' in r ? r.room_code !== roomCode : true));
        setDeletingRooms((prev) => {
          const next = new Set(prev);
          next.delete(roomCode);
          return next;
        });
      }, 500); // Wait for exit animation
      addToast({ type: 'info', message: t('rooms.deleted') });
    } catch {
      addToast({ type: 'error', message: t('common.error') });
    }
  }, [addToast]);

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
          <h1 className="text-display-sm font-display text-ink">filesync</h1>
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
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="lg"
              onClick={() => setShowCreate(!showCreate)}
            >
              + {t('rooms.create')}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={handleScanQR}
              aria-label={t('rooms.scanQR')}
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 7V5a2 2 0 012-2h2" />
                <path d="M17 3h2a2 2 0 012 2v2" />
                <path d="M21 17v2a2 2 0 01-2 2h-2" />
                <path d="M7 21H5a2 2 0 01-2-2v-2" />
                <rect x="7" y="7" width="6" height="6" rx="1" />
                <rect x="7" y="15" width="6" height="2" rx="0.5" />
                <rect x="15" y="7" width="2" height="6" rx="0.5" />
              </svg>
              {t('rooms.scanQR')}
            </Button>
          </div>

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
            <AnimatePresence>
              {rooms.map((room) => {
                const isCached = hasRoomKey(room.room_code);
                const isDeleting = deletingRooms.has(room.room_code);

                return (
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
                    exit={{
                      opacity: 0,
                      scale: 0.9,
                      transition: { duration: 0.4, ease: 'easeInOut' },
                    }}
                    className="relative"
                  >
                    <Card
                      padding="md"
                      className={`cursor-pointer hover:shadow-sm transition-shadow ${
                        isCached ? 'bg-blue-50/40 border-blue-200/60' : ''
                      } ${isDeleting ? 'opacity-50 pointer-events-none' : ''}`}
                      onClick={() => handleRoomClick(room.room_code)}
                      whileHover={isDeleting ? {} : { scale: 1.01 }}
                      whileTap={isDeleting ? {} : { scale: 0.99 }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <code className="text-display-sm font-display text-ink">
                            {room.room_code}
                          </code>
                          {isCached && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium" title={t('rooms.cachedKey')}>
                              {t('rooms.cachedKey')}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-muted">
                          {room.member_count} {t('rooms.members')}
                          {'file_count' in room && (room as AdminRoomRow).file_count !== undefined && (
                            <> · {(room as AdminRoomRow).file_count} {t('rooms.files')}</>
                          )}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs text-muted-soft">
                          {t('rooms.created')}: {new Date(room.created_at).toLocaleDateString()}
                        </span>
                        {/* Admin delete button */}
                        {isAdmin && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={(e) => handleDeleteRoom(room.room_code, e as unknown as React.MouseEvent)}
                            className="text-[10px] px-2 py-0.5"
                            aria-label={`${t('rooms.deleteRoom')} ${room.room_code}`}
                          >
                            <svg
                              className="w-3 h-3"
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
                            </svg>
                            {t('rooms.deleteRoom')}
                          </Button>
                        )}
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </main>

      {/* QR Scanner Overlay */}
      <AnimatePresence>
        {scanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-[900] flex flex-col items-center justify-center p-4"
          >
            <video
              ref={videoRef}
              className="max-w-full max-h-[70vh] rounded-lg"
              playsInline
              aria-label={t('rooms.scanQR')}
            />
            <Button
              variant="ghost"
              onClick={() => {
                scanningRef.current = false;
                setScanning(false);
                if (streamRef.current) {
                  streamRef.current.getTracks().forEach((t) => t.stop());
                  streamRef.current = null;
                }
              }}
              className="mt-4 text-white"
            >
              {t('common.cancel')}
            </Button>
            {scanError && (
              <p className="text-error mt-2 text-sm" role="alert">{scanError}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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
