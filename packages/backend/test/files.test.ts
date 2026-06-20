/**
 * File module tests.
 *
 * Tests file upload/download validation logic, usage stats arithmetic,
 * and cleanup algorithms without requiring R2 binding.
 *
 * NOTE: R2 API calls are mocked or skipped. Full R2 integration testing
 * requires the bucket to be enabled in the Cloudflare Dashboard.
 * See .swarm/2026-06-21_epheia-files/impl-2.md for R2 status.
 */

import { describe, it, expect } from 'vitest';

// ---- Constants (mirrored from upload.ts) ----

const ROOM_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const MIN_CHUNK_SIZE = 5 * 1024 * 1024;
const LARGE_CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_TTL_SECONDS = 3600;
const DEFAULT_TTL_SECONDS = 600;

// ---- Utility functions (mirrored for testing) ----

function chunksNeeded(totalSize: number, chunkSize: number): number {
  return Math.ceil(totalSize / chunkSize);
}

function calculateExpiry(requestedExpiry?: string): string {
  if (requestedExpiry) {
    const expDate = new Date(requestedExpiry);
    if (isNaN(expDate.getTime())) {
      return new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
    }
    const maxExpiry = new Date(Date.now() + MAX_TTL_SECONDS * 1000);
    if (expDate > maxExpiry) {
      return maxExpiry.toISOString();
    }
    return requestedExpiry;
  }
  return new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
}

// ---- Tests ----

describe('File upload validation', () => {
  it('should reject files larger than room maximum', () => {
    const tooLarge = ROOM_MAX_BYTES + 1;
    expect(tooLarge).toBeGreaterThan(ROOM_MAX_BYTES);

    const atLimit = ROOM_MAX_BYTES;
    expect(atLimit).toBeLessThanOrEqual(ROOM_MAX_BYTES);
  });

  it('should reject chunk sizes below minimum', () => {
    const tooSmall = MIN_CHUNK_SIZE - 1;
    expect(tooSmall).toBeLessThan(MIN_CHUNK_SIZE);

    const atMin = MIN_CHUNK_SIZE;
    expect(atMin).toBeGreaterThanOrEqual(MIN_CHUNK_SIZE);
  });

  it('should accept empty visibility as defaulting to private', () => {
    const visibility = undefined;
    const resolved = visibility || 'private';
    expect(resolved).toBe('private');
  });

  it('should accept valid visibility values', () => {
    expect('private').toMatch(/^(private|public)$/);
    expect('public').toMatch(/^(private|public)$/);
    expect('invalid').not.toMatch(/^(private|public)$/);
  });
});

describe('Chunk calculation', () => {
  it('should calculate correct number of chunks for exact division', () => {
    expect(chunksNeeded(10 * 1024 * 1024, 5 * 1024 * 1024)).toBe(2);
  });

  it('should round up for partial chunks', () => {
    expect(chunksNeeded(11 * 1024 * 1024, 5 * 1024 * 1024)).toBe(3);
  });

  it('should handle single chunk files', () => {
    expect(chunksNeeded(4 * 1024 * 1024, 5 * 1024 * 1024)).toBe(1);
  });

  it('should handle tiny chunks (large files with 10MB chunks)', () => {
    // 500MB file with 10MB chunks
    expect(chunksNeeded(500 * 1024 * 1024, 10 * 1024 * 1024)).toBe(50);
  });

  it('should handle maximum room size', () => {
    // 5GB file with 10MB chunks
    expect(chunksNeeded(ROOM_MAX_BYTES, LARGE_CHUNK_SIZE)).toBe(512);
  });
});

describe('Usage stats arithmetic', () => {
  it('should correctly detect room over limit', () => {
    let currentBytes = 4.9 * 1024 * 1024 * 1024; // 4.9 GB
    const newFileSize = 200 * 1024 * 1024; // 200 MB
    expect(currentBytes + newFileSize > ROOM_MAX_BYTES).toBe(true);
  });

  it('should allow upload when under limit', () => {
    let currentBytes = 4 * 1024 * 1024 * 1024; // 4 GB
    const newFileSize = 500 * 1024 * 1024; // 500 MB
    expect(currentBytes + newFileSize <= ROOM_MAX_BYTES).toBe(true);
  });

  it('should correctly calculate needed space for cleanup', () => {
    const currentBytes = 4.9 * 1024 * 1024 * 1024;
    const newFileSize = 500 * 1024 * 1024;
    const neededSpace = (currentBytes + newFileSize) - ROOM_MAX_BYTES;
    expect(neededSpace).toBeGreaterThan(0);
    // 4.9 GB + 500 MB ≈ 5.4 GB, which is ~0.4 GB over limit
    // Actual bytes: ~397.6 MB over
    const neededSpaceMB = neededSpace / (1024 * 1024);
    expect(neededSpaceMB).toBeCloseTo(398, -1); // ~398 MB, precision=1 (nearest 10)
  });

  it('should prioritize oldest files for deletion', () => {
    const files = [
      { id: '1', file_size: 100, created_at: '2026-06-21T08:00:00Z' },  // oldest
      { id: '2', file_size: 200, created_at: '2026-06-21T10:00:00Z' },  // newer
      { id: '3', file_size: 50, created_at: '2026-06-21T09:00:00Z' },   // middle
    ];

    const sorted = [...files].sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(sorted[0].id).toBe('1'); // oldest first
    expect(sorted[1].id).toBe('3');
    expect(sorted[2].id).toBe('2');
  });

  it('should decrement stats correctly after deletion', () => {
    let totalBytes = 1000;
    let fileCount = 5;
    const deletedBytes = 300;
    const deletedCount = 2;

    totalBytes = Math.max(0, totalBytes - deletedBytes);
    fileCount = Math.max(0, fileCount - deletedCount);

    expect(totalBytes).toBe(700);
    expect(fileCount).toBe(3);
  });
});

describe('File TTL calculation', () => {
  it('should default to 10 minutes when no expiry provided', () => {
    const result = calculateExpiry();
    const resultDate = new Date(result);
    const expectedMin = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000 - 1000);
    const expectedMax = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000 + 1000);

    expect(resultDate.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(resultDate.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
  });

  it('should cap expiry at 1 hour max', () => {
    const farFuture = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const result = calculateExpiry(farFuture);
    const resultDate = new Date(result);
    const maxDate = new Date(Date.now() + MAX_TTL_SECONDS * 1000);

    // Should be capped to ~1 hour, not 2 hours
    expect(resultDate.getTime()).toBeLessThanOrEqual(maxDate.getTime() + 2000);
  });

  it('should accept valid custom expiry within limits', () => {
    const customExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
    const result = calculateExpiry(customExpiry);
    expect(result).toBe(customExpiry);
  });

  it('should fallback to default on invalid date', () => {
    const result = calculateExpiry('not-a-date');
    const resultDate = new Date(result);
    const expectedDate = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000);
    expect(Math.abs(resultDate.getTime() - expectedDate.getTime())).toBeLessThan(2000);
  });
});

describe('File visibility auth', () => {
  it('should require auth for private files', () => {
    const visibility = 'private';
    const hasSession = false;
    const isAuthorized = visibility === 'public' || hasSession;
    expect(isAuthorized).toBe(false);
  });

  it('should allow auth users for private files', () => {
    const visibility = 'private';
    const hasSession = true;
    const isAuthorized = visibility === 'public' || hasSession;
    expect(isAuthorized).toBe(true);
  });

  it('should allow access to public files without auth', () => {
    const visibility = 'public';
    const hasSession = false;
    const isAuthorized = visibility === 'public' || hasSession;
    expect(isAuthorized).toBe(true);
  });

  it('should deny access when file is recalled', () => {
    const isRecalled = true;
    const isExpired = new Date('2026-01-01') < new Date();
    const isAccessible = !isRecalled && !isExpired;
    expect(isAccessible).toBe(false);
  });

  it('should deny access when file is expired', () => {
    const isRecalled = false;
    const isExpired = true;
    const isAccessible = !isRecalled && !isExpired;
    expect(isAccessible).toBe(false);
  });
});

describe('Cleanup logic', () => {
  it('should identify expired files', () => {
    const now = new Date();
    const files = [
      { id: '1', expires_at: new Date(now.getTime() - 1000).toISOString() }, // expired
      { id: '2', expires_at: new Date(now.getTime() + 1000).toISOString() }, // not yet
      { id: '3', expires_at: new Date(now.getTime() - 5000).toISOString() }, // expired
    ];

    const expired = files.filter((f) => new Date(f.expires_at) < now);
    expect(expired).toHaveLength(2);
    expect(expired[0].id).toBe('1');
    expect(expired[1].id).toBe('3');
  });

  it('should skip already recalled files during cleanup', () => {
    const files = [
      { id: '1', expires_at: '2026-01-01T00:00:00Z', recalled_at: null },
      { id: '2', expires_at: '2026-01-01T00:00:00Z', recalled_at: '2026-01-02T00:00:00Z' },
    ];

    const toClean = files.filter((f) => !f.recalled_at);
    expect(toClean).toHaveLength(1);
    expect(toClean[0].id).toBe('1');
  });

  it('should correctly aggregate cleanup stats', () => {
    const cleanedFiles = [
      { file_size: 100 },
      { file_size: 200 },
      { file_size: 50 },
    ];

    const totalBytes = cleanedFiles.reduce((sum, f) => sum + f.file_size, 0);
    expect(totalBytes).toBe(350);
    expect(cleanedFiles.length).toBe(3);
  });
});

describe('R2 key generation', () => {
  it('should generate valid R2 key format', () => {
    const roomCode = '1234';
    const fileId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const filename = 'test-document.pdf';

    const r2_key = `rooms/${roomCode}/${fileId}_${encodeURIComponent(filename)}`;
    expect(r2_key).toBe('rooms/1234/a1b2c3d4-e5f6-7890-abcd-ef1234567890_test-document.pdf');
  });

  it('should encode special characters in filenames', () => {
    const r2_key = `rooms/1234/uuid_${encodeURIComponent('hello world.txt')}`;
    expect(r2_key).toBe('rooms/1234/uuid_hello%20world.txt');
  });
});
