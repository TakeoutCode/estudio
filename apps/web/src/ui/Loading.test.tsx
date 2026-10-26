import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Loading, SKELETON_DELAY_MS } from './Loading';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Loading (UI-UX UX3)', () => {
  it('no muestra nada los primeros 300 ms y después un esqueleto que se anuncia como carga', () => {
    const { container } = render(<Loading />);
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(container.innerHTML).toBe('');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText('Cargando…')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});
