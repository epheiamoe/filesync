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
import { buildLoginUrl } from '@/lib/url';
import { parseDeviceLabel } from '@/lib/device';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { QRShare } from '@/components/shared/QRShare';
import { Spinner } from '@/components/ui/Spinner';
import type { AdminRoomRow, RoomInfo } from '@shared/types';

// Pre-load jsQR module to avoid network delay during scan
let jsQRModule: typeof import('jsqr') | null = null;
async function preloadJsQR(): Promise<typeof import('jsqr') | null> {
  if (jsQRModule) return jsQRModule;
  try {
    jsQRModule = await import('jsqr');
    return jsQRModule;
  } catch (e) {
    console.error('[QR] Failed to load jsQR:', e);
    return null;
  }
}
// Start preloading immediately
preloadJsQR();

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
  const [scanChoiceOpen, setScanChoiceOpen] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanMode, setScanMode] = useState<'camera' | 'image' | null>(null);
  const [scanProcessing, setScanProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const scanProcessingRef = useRef(false);
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

  // Stop camera scanning (extracted to component level for reuse)
  const stopScanning = useCallback(() => {
    scanningRef.current = false;
    scanProcessingRef.current = false;
    setScanning(false);
    setScanMode(null);
    setScanError('');
    setScanProcessing(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Auto-join room for already-authenticated users
  const handleAutoJoin = useCallback(async (roomCode: string, key: Uint8Array) => {
    setJoining(true);
    try {
      const keyHash = await hashKey(key);
      const deviceLabel = parseDeviceLabel();
      await api.joinRoom(roomCode, keyHash, deviceLabel);
      storeRoomKey(roomCode, key);
      addToast({ type: 'success', message: t('rooms.joined') });
      navigate(`/room/${roomCode}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('rooms.keyMismatch');
      console.error('[QR Scan] Auto-join failed:', err);
      addToast({ type: 'error', message });
      throw err; // Re-throw so caller can handle overlay state
    } finally {
      setJoining(false);
    }
  }, [navigate, addToast]);

  // Process QR scan result: extract share string, auto-join if authenticated
  const processScanResult = useCallback(async (content: string): Promise<boolean> => {
    let rawShare: string | null = null;

    // Try to find login#<shareString>[-<credential>] pattern
    const loginMatch = content.match(/login#(.+)/);
    if (loginMatch) {
      rawShare = decodeURIComponent(loginMatch[1]);
    }
    // Direct share string format: "4821-XXXX-XXXX-..."
    else if (/^\d{4}-[0-9A-HJKMNP-TV-Z]+(-[0-9A-HJKMNP-TV-Z]+)*$/i.test(content)) {
      rawShare = content;
    }

    if (!rawShare) return false;

    // Strip credential if present (last 6-char segment after dash)
    const lastDash = rawShare.lastIndexOf('-');
    let shareString = rawShare;
    if (lastDash > 4) {
      const potentialCred = rawShare.slice(lastDash + 1);
      if (potentialCred.length === 6 && /^[A-Za-z0-9]{6}$/.test(potentialCred)) {
        shareString = rawShare.slice(0, lastDash);
      }
    }

    // If already authenticated → auto-join the room directly
    const { isAuthenticated } = useStore.getState();
    if (isAuthenticated) {
      const decoded = decodeShareString(shareString);
      if (decoded) {
        setScanProcessing(true);
        scanProcessingRef.current = true;
        try {
          await handleAutoJoin(decoded.roomCode, decoded.key);
          // Success: handleAutoJoin navigates away, overlay will unmount
          return true;
        } catch (err) {
          // Auto-join failed — show error in overlay and keep it open
          const message = err instanceof Error ? err.message : t('rooms.keyMismatch');
          setScanError(message);
          setScanProcessing(false);
          scanProcessingRef.current = false;
          return true;
        }
      }
    }

    // Not authenticated or invalid share → navigate to login
    stopScanning();
    navigate(`/login#${encodeURIComponent(rawShare)}`);
    return true;
  }, [navigate, stopScanning, handleAutoJoin]);

  // Show scan method choice dialog
  const handleScanQR = () => {
    setScanChoiceOpen(true);
  };

  // Scan with camera (uses jsQR for cross-browser compatibility)
  // CRITICAL: This handler MUST be synchronous. Samsung/Edge Android browsers
  // require getUserMedia() to be called synchronously within the click event.
  // Any async/await in this handler causes the browser to skip the permission
  // prompt and immediately return 'Permission Denied'.
  const handleCameraScan = () => {
    console.log('[QR Camera] Step 1: Button clicked, starting synchronous getUserMedia');
    
    // Step 1: Start getUserMedia IMMEDIATELY (synchronous Promise creation)
    let streamPromise: Promise<MediaStream> | null = null;
    if (navigator.mediaDevices?.getUserMedia) {
      try {
        streamPromise = navigator.mediaDevices.getUserMedia({ video: true });
        console.log('[QR Camera] Step 2: getUserMedia Promise created synchronously');
      } catch (e) {
        console.error('[QR Camera] Step 2: getUserMedia synchronous throw:', e);
      }
    }

    // Step 2: Now safe to do React state updates
    setScanChoiceOpen(false);
    setScanMode('camera');
    setScanning(true);
    setScanError('');
    setScanProcessing(false);
    scanProcessingRef.current = false;
    scanningRef.current = true;

    // Step 3: Check if mediaDevices API exists
    if (!streamPromise) {
      console.error('[QR Camera] Step 3: getUserMedia not available');
      setScanError(t('rooms.scanNoCamera'));
      return;
    }

    // Step 4: Handle the stream asynchronously using .then() chain
    // (NOT async/await, to keep the original event handler synchronous)
    streamPromise
      .then((stream) => {
        console.log('[QR Camera] Step 4: Stream obtained successfully');
        streamRef.current = stream;
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          return videoRef.current.play();
        }
        return Promise.resolve();
      })
      .then(() => {
        console.log('[QR Camera] Step 5: Video playing, loading jsQR');
        return preloadJsQR();
      })
      .then((jsQRMod) => {
        if (!jsQRMod) {
          console.error('[QR Camera] Step 6: jsQR load failed');
          setScanError(t('rooms.scanNotSupported'));
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
          return;
        }
        
        const jsQR = jsQRMod.default;
        console.log('[QR Camera] Step 6: jsQR loaded, starting scan loop');
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('[QR Camera] Step 6: Canvas context failed');
          setScanError(t('rooms.scanError'));
          stopScanning();
          return;
        }

        const scanFrame = () => {
          if (!videoRef.current || !scanningRef.current || scanProcessingRef.current) return;

          const video = videoRef.current;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);

            try {
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height);
              if (code) {
                console.log('[QR Camera] Step 7: QR code found:', code.data.substring(0, 20) + '...');
                processScanResult(code.data).then((handled) => {
                  if (handled) {
                    console.log('[QR Camera] Step 8: QR processed successfully');
                    return;
                  }
                  console.log('[QR Camera] Step 8: QR not recognized, continuing scan');
                }).catch((err) => {
                  console.error('[QR Camera] Step 8: processScanResult error:', err);
                });
                return;
              }
            } catch {
              // Single frame decode error — continue scanning
            }
          }

          if (scanningRef.current && !scanProcessingRef.current) {
            requestAnimationFrame(scanFrame);
          }
        };

        requestAnimationFrame(scanFrame);
      })
      .catch((err) => {
        console.error('[QR Camera] Stream error:', err.name, err.message);
        // Permission denied or no camera — try to determine which
        if (navigator.mediaDevices?.enumerateDevices) {
          navigator.mediaDevices.enumerateDevices()
            .then((devices) => {
              const hasCamera = devices.some((d) => d.kind === 'videoinput');
              console.error('[QR Camera] Has camera device:', hasCamera);
              setScanError(hasCamera ? t('rooms.scanCameraDenied') : t('rooms.scanNoCamera'));
            })
            .catch(() => {
              setScanError(t('rooms.scanCameraDenied'));
            });
        } else {
          setScanError(t('rooms.scanCameraDenied'));
        }
      });
  };

  // Helper: get ImageData from a File, with fallback for older browsers
  const getImageDataFromFile = async (file: File): Promise<ImageData> => {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    // Fallback for browsers without createImageBitmap
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
        };
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Scan from uploaded image
  const handleImageScan = () => {
    console.log('[QR Image] Step 1: Opening file picker');
    setScanChoiceOpen(false);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        console.log('[QR Image] Step 2: No file selected');
        return;
      }
      console.log('[QR Image] Step 2: File selected:', file.name, file.type, file.size);

      // Show scanning state while processing
      setScanMode('image');
      setScanning(true);
      setScanError('');
      setScanProcessing(false);
      scanProcessingRef.current = false;
      scanningRef.current = true;

      try {
        // Load jsQR (should be preloaded)
        console.log('[QR Image] Step 3: Loading jsQR...');
        const jsQRMod = await preloadJsQR();
        if (!jsQRMod) {
          console.error('[QR Image] Step 3: jsQR not available');
          setScanError(t('rooms.scanNotSupported'));
          return;
        }
        const jsQR = jsQRMod.default;
        console.log('[QR Image] Step 3: jsQR loaded');

        // Convert file to ImageData
        console.log('[QR Image] Step 4: Converting file to ImageData...');
        const imageData = await getImageDataFromFile(file);
        console.log('[QR Image] Step 4: ImageData obtained:', imageData.width, 'x', imageData.height);

        // Decode QR
        console.log('[QR Image] Step 5: Decoding QR...');
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        console.log('[QR Image] Step 5: QR decode result:', code ? 'FOUND' : 'NOT FOUND');

        if (code) {
          // QR found — process result
          console.log('[QR Image] Step 6: Processing QR data:', code.data.substring(0, 30) + '...');
          const handled = await processScanResult(code.data);
          console.log('[QR Image] Step 6: processScanResult returned:', handled);
          if (handled) {
            return; // Processing or done
          }
        }

        // No QR found
        console.log('[QR Image] Step 7: No QR found in image');
        setScanError(t('rooms.scanNoQR'));
      } catch (err) {
        console.error('[QR Image] Error:', err);
        const message = err instanceof Error ? err.message : '';
        if (message.includes('timeout') || message.includes('aborted')) {
          setScanError(t('rooms.scanError') + ' (请求超时，请检查网络)');
        } else {
          setScanError(t('rooms.scanError') + ': ' + message);
        }
      }
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
            {/* Camera stream view */}
            {streamRef.current ? (
              <video
                ref={videoRef}
                className="max-w-full max-h-[60vh] rounded-lg"
                playsInline
                aria-label={t('rooms.scanQR')}
              />
            ) : (
              /* Processing state (camera loading or image processing) */
              <div className="flex flex-col items-center gap-4 text-white">
                {scanMode === 'image' ? (
                  /* Image processing icon */
                  <svg
                    className="w-12 h-12 animate-pulse"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                ) : (
                  /* Camera / QR scanning icon */
                  <svg
                    className="w-12 h-12 animate-pulse"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
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
                )}
                <p className="text-sm">
                  {scanError
                    ? ''
                    : scanMode === 'image'
                      ? t('rooms.scanProcessingImage')
                      : t('rooms.scanningQR')}
                </p>
              </div>
            )}

            {/* Error message — prominent, stays visible until user dismisses */}
            {scanError && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 max-w-sm w-full"
              >
                <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-4 text-center">
                  <p className="text-red-300 text-sm font-medium" role="alert">
                    {scanError}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Processing state — QR found, joining room */}
            {scanProcessing && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-4 max-w-sm w-full flex flex-col items-center gap-3"
              >
                <div className="bg-blue-500/20 border border-blue-500/40 rounded-lg p-6 text-center w-full">
                  <div className="flex justify-center mb-3">
                    <Spinner size="lg" />
                  </div>
                  <p className="text-blue-300 text-sm font-medium" role="status" aria-live="polite">
                    {t('rooms.scanJoining')}
                  </p>
                </div>
              </motion.div>
            )}

            {/* Action buttons */}
            <div className="mt-4 flex flex-col gap-2 items-center">
              {/* Camera failed — offer switch to image upload */}
              {scanError && scanMode === 'camera' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    stopScanning();
                    // Small delay to let overlay close before opening file picker
                    setTimeout(() => handleImageScan(), 300);
                  }}
                >
                  <svg
                    className="w-4 h-4 mr-1"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  {t('rooms.scanSwitchToImage')}
                </Button>
              )}

              <Button
                variant="ghost"
                onClick={stopScanning}
                className="text-white"
              >
                {t('common.cancel')}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR Scanner — Scan Method Choice */}
      <AnimatePresence>
        {scanChoiceOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[900] flex items-center justify-center p-4"
            onClick={() => setScanChoiceOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-canvas rounded-xl p-6 max-w-xs w-full shadow-xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label={t('rooms.scanChoiceTitle')}
            >
              <h2 className="text-title-md font-display text-ink text-center mb-6">
                {t('rooms.scanChoiceTitle')}
              </h2>
              <div className="flex flex-col gap-3">
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  onClick={handleCameraScan}
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
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  {t('rooms.scanWithCamera')}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={handleImageScan}
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
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  {t('rooms.scanFromImage')}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                onClick={() => setScanChoiceOpen(false)}
                className="mt-4"
              >
                {t('common.cancel')}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR Share Modal */}
      <QRShare
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        shareString={qrData.shareString}
        roomCode={qrData.roomCode}
        isAdmin={isAdmin}
        onGenerateCredential={async () => {
          const result = await api.createTempCredential();
          const loginUrl = buildLoginUrl(qrData.shareString, result.code);
          return { code: result.code, expires_at: result.expires_at };
        }}
      />
    </div>
  );
}
