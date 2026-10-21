import { describe, expect, it } from 'vitest';
import catalog from '../../i18n/es/notifications.json' with { type: 'json' };
import { list, reminderBody, text } from './texts.js';

describe('textos de los avisos (NT5, NT6)', () => {
  it('plurales y listas en español', () => {
    expect(text('due', { count: 1 })).toBe('1 tarjeta pendiente');
    expect(text('due', { count: 23 })).toBe('23 tarjetas pendientes');
    expect(list(['Huesos'])).toBe('Huesos');
    expect(list(['Huesos', 'Nervios', 'Vasos'])).toBe('Huesos, Nervios y Vasos');
  });

  it('NT5: examen, plan y pendientes en ese orden', () => {
    expect(
      reminderBody({
        examSoon: [{ title: 'Parcial 1', days: 1 }],
        studyPlan: { count: 12, topics: ['Huesos del carpo', 'Manguito rotador'] },
        due: { count: 23, topics: [] },
      }),
    ).toBe(
      'Parcial 1 en 1 día · Plan de hoy: 12 nuevas de Huesos del carpo y Manguito rotador · 23 tarjetas pendientes',
    );
    expect(reminderBody({ examSoon: [], studyPlan: { count: 1, topics: [] }, due: null })).toBe(
      'Plan de hoy: 1 nueva',
    );
  });

  it('NT-T10, R19: ninguna clave ni texto habla de rachas, atrasos o urgencia', () => {
    const all = Object.entries(catalog).flat().join(' ');
    expect(all).not.toMatch(/racha|streak|atrasad|pierdes|perder|ya mismo|¡/i);
  });
});
