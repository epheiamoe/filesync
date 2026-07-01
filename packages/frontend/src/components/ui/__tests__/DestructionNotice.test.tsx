import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { DestructionNotice } from '@/components/ui/DestructionNotice';
import { useStore } from '@/lib/store';

function renderWithMotion(element: React.ReactElement) {
  return render(<MotionConfig reducedMotion="always">{element}</MotionConfig>);
}

describe('DestructionNotice', () => {
  beforeEach(() => {
    useStore.getState().dismissDestruction();
  });

  it('does not render when there are no destruction events', () => {
    renderWithMotion(<DestructionNotice />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a card when destruction events exist', () => {
    useStore.setState({
      destructionEvents: [{ sourceId: 'msg-1', occurredAt: Date.now() }],
    });

    renderWithMotion(<DestructionNotice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('displays the correct count', () => {
    useStore.setState({
      destructionEvents: [
        { sourceId: 'msg-1', occurredAt: Date.now() },
        { sourceId: 'msg-2', occurredAt: Date.now() },
      ],
    });

    renderWithMotion(<DestructionNotice />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });

  it('dismisses when the close button is clicked', async () => {
    useStore.setState({
      destructionEvents: [{ sourceId: 'msg-1', occurredAt: Date.now() }],
    });

    renderWithMotion(<DestructionNotice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    const closeButton = screen.getByTestId('destruction-close');
    act(() => {
      closeButton.click();
    });

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('auto-dismisses after 10 seconds of idle time', async () => {
    useStore.getState().reportDestruction('msg-1');
    renderWithMotion(<DestructionNotice />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      },
      { timeout: 12_000 },
    );
  }, 15_000);

  it('resets the idle timer when a new event arrives within 10 seconds', async () => {
    useStore.getState().reportDestruction('msg-1');
    renderWithMotion(<DestructionNotice />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Wait 9 seconds; the notice should still be visible.
    await new Promise((r) => setTimeout(r, 9_000));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // A new event resets the timer.
    useStore.getState().reportDestruction('msg-2');

    // Wait another 9 seconds since the new event; still visible.
    await new Promise((r) => setTimeout(r, 9_000));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // After 1 more second the 10-second idle window expires.
    await waitFor(
      () => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      },
      { timeout: 3_000 },
    );
  }, 22_000);
});
