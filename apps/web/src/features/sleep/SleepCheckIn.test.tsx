import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { updateStudyConfig } from '@/features/settings';
import { SleepCheckIn } from './SleepCheckIn';

const ME = '0192f1a0-0000-7000-8000-00000000c0de';

const enableSleep = () =>
  updateStudyConfig((c) => ({
    ...c,
    metrics: { ...c.metrics, visible: { ...c.metrics.visible, sleep: true } },
  }));

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: ME });
});

describe('SleepCheckIn (§5)', () => {
  it('apagado por defecto: Hoy no pregunta nada', async () => {
    const { container } = render(<SleepCheckIn />);
    await db.sleepLogs.count(); // deja correr la consulta en vivo
    expect(container.textContent).toBe('');
  });

  it('un toque anota la noche y queda en una línea; "Cambiar" deja corregirla', async () => {
    await enableSleep();
    render(<SleepCheckIn />);
    const four = await screen.findByRole('button', { name: '4 de 5: Bien' });
    expect(screen.getAllByRole('button')).toHaveLength(5);
    fireEvent.click(four);
    expect(await screen.findByText('Anoche: 4 de 5')).toBeTruthy();
    expect((await db.sleepLogs.toArray()).map((n) => n.quality)).toEqual([4]);

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByRole('button', { name: '4 de 5: Bien' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '2 de 5: Mal' }));
    expect(await screen.findByText('Anoche: 2 de 5')).toBeTruthy();
    expect((await db.sleepLogs.toArray()).map((n) => n.quality)).toEqual([2]);
  });

  it('R19: sin racha, metas ni culpa en el texto', async () => {
    await enableSleep();
    const { container } = render(<SleepCheckIn />);
    await screen.findByRole('group');
    expect(container.textContent).not.toMatch(/racha|meta diaria|deberías|perdiste/i);
  });
});
