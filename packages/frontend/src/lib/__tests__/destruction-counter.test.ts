import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pruneEvents, useStore } from '@/lib/store';

describe('pruneEvents', () => {
  const now = 1_000_000;

  it('returns an empty array when events is empty', () => {
    expect(pruneEvents([], now)).toEqual([]);
  });

  it('keeps all events when all occurred within the last 60 seconds', () => {
    const events = [
      { sourceId: 'a', occurredAt: now - 30_000 },
      { sourceId: 'b', occurredAt: now - 45_000 },
      { sourceId: 'c', occurredAt: now - 5_000 },
    ];
    expect(pruneEvents(events, now)).toEqual(events);
  });

  it('drops events older than 60 seconds while keeping newer ones', () => {
    const events = [
      { sourceId: 'a', occurredAt: now - 30_000 },
      { sourceId: 'b', occurredAt: now - 70_000 },
      { sourceId: 'c', occurredAt: now - 10_000 },
    ];
    expect(pruneEvents(events, now)).toEqual([
      { sourceId: 'a', occurredAt: now - 30_000 },
      { sourceId: 'c', occurredAt: now - 10_000 },
    ]);
  });

  it('returns an empty array when every event is older than 60 seconds', () => {
    const events = [
      { sourceId: 'a', occurredAt: now - 61_000 },
      { sourceId: 'b', occurredAt: now - 120_000 },
    ];
    expect(pruneEvents(events, now)).toEqual([]);
  });

  it('drops an event exactly at the 60-second boundary (strict greater-than cutoff)', () => {
    const events = [{ sourceId: 'a', occurredAt: now - 60_000 }];
    expect(pruneEvents(events, now)).toEqual([]);
  });
});

describe('reportDestruction deduplication', () => {
  beforeEach(() => {
    // Reset both the Zustand state and the module-level deduplication Set/timer.
    useStore.getState().dismissDestruction();
  });

  it('counts the same sourceId only once', () => {
    useStore.getState().reportDestruction('msg-1');
    useStore.getState().reportDestruction('msg-1');
    useStore.getState().reportDestruction('msg-1');

    expect(useStore.getState().destructionEvents).toHaveLength(1);
  });

  it('counts different sourceIds separately', () => {
    useStore.getState().reportDestruction('msg-1');
    useStore.getState().reportDestruction('file-1');
    useStore.getState().reportDestruction('msg-1');

    expect(useStore.getState().destructionEvents).toHaveLength(2);
  });

  it('counts recalled sourceIds the same way as expired ones', () => {
    // Recall events use the same reportDestruction action and share the same
    // sourceId namespace, so they must be counted and deduplicated correctly.
    useStore.getState().reportDestruction('msg-recalled-1');
    useStore.getState().reportDestruction('msg-recalled-1');
    useStore.getState().reportDestruction('file-recalled-1');

    expect(useStore.getState().destructionEvents).toHaveLength(2);
  });
});

describe('reportDestruction performance', () => {
  beforeEach(() => {
    // Reset both the Zustand state and the module-level deduplication Set/timer.
    useStore.getState().dismissDestruction();
  });

  it('handles 1000 events within the window without crashing', () => {
    const now = Date.now();
    for (let i = 0; i < 1000; i++) {
      useStore.getState().reportDestruction(`id-${i}`);
    }

    expect(useStore.getState().destructionEvents).toHaveLength(1000);
  });
});
