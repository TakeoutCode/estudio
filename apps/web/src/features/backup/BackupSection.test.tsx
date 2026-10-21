import { BACKUP_FORMAT, BACKUP_VERSION, encodeHlc, newId } from '@estudio/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { BackupSection } from './BackupSection';

const ME = '0192f1a0-0000-7000-8000-00000000c0de';

const file = (content: string) => new File([content], 'respaldo.json', { type: 'application/json' });
const pick = (input: HTMLElement, chosen: File) => {
  fireEvent.change(input, { target: { files: [chosen] } });
};

beforeEach(async () => {
  await db.delete({ disableAutoOpen: false });
  await db.meta.put({ key: 'accountUserId', value: ME });
});

describe('Ajustes › Respaldo (QUALITY QA7)', () => {
  it('un archivo que no es un respaldo avisa sin tocar nada; uno válido muestra qué trae y lo importa', async () => {
    render(<BackupSection />);
    const input = await screen.findByLabelText('Importar un respaldo');
    pick(input, file('{"no": "es un respaldo"}'));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Este archivo no es un respaldo de Estudio o está dañado.',
    );

    const deck = {
      id: newId(),
      name: 'Carpo',
      description: null,
      pausedAt: null,
      hlc: encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: newId() }),
      updatedAt: 1_760_000_000_000,
      deletedAt: null,
    };
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.UTC(2026, 9, 1, 18),
      userId: ME,
      entities: { deck: [deck] },
    };
    pick(input, file(JSON.stringify(backup)));
    expect(await screen.findByText('Tarjetas: 0 · Repasos: 0 · Exámenes: 0')).toBeTruthy();
    expect(screen.queryByText(/otra cuenta/)).toBeNull();
    expect(await db.decks.count()).toBe(0); // nada se escribe antes de confirmar
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Listo: se importaron 0 tarjetas y 0 repasos. Se envían al servidor cuando haya conexión.',
    );
    expect((await db.decks.get(deck.id))?.name).toBe('Carpo');
  });

  it('un respaldo de una versión más nueva pide actualizar la app', async () => {
    render(<BackupSection />);
    pick(
      await screen.findByLabelText('Importar un respaldo'),
      file(JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION + 1 })),
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/versión más nueva/);
  });
});
