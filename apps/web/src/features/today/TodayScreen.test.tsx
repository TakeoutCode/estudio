import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TodayScreen } from './TodayScreen';

describe('TodayScreen', () => {
  it('UX3: muestra el estado vacío con una salida, sin lenguaje de atraso', () => {
    const { container } = render(<TodayScreen />);
    expect(screen.getByRole('heading', { name: 'Hoy' })).toBeTruthy();
    expect(screen.getByText(/No hay tarjetas pendientes/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/atrasad|vencid/i);
  });
});
