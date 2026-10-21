import { BACKUP_FORMAT, BACKUP_VERSION, type Backup, encodeHlc, newId, parseBackup } from '@estudio/shared';
import { describe, expect, it } from 'vitest';
import { buildSpreadsheets, toCsv } from './spreadsheets';

const hlc = encodeHlc({ wall: 1_760_000_000_000, counter: 0, node: '0192f1a0-0000-7000-8000-000000000001' });
const meta = (id = newId()) => ({ id, hlc, updatedAt: 1, deletedAt: null });
const T = Date.UTC(2026, 9, 20, 15, 30, 5); // 09:30:05 en Ciudad de México

function sample(): Backup {
  const deck = { ...meta(), name: 'Mano', description: null, pausedAt: null };
  const topic = { ...meta(), deckId: deck.id, name: 'Carpo', explanation: '' };
  const occlusion = {
    ...meta(),
    deckId: deck.id,
    topicId: topic.id,
    origin: 'manual',
    content: {
      kind: 'image_occlusion',
      imageAssetId: newId(),
      prompt: '¿Qué hueso es?',
      alt: 'Mano',
      mode: 'hide_all',
      groups: [
        { n: 1, label: 'Escafoides', rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }] },
        { n: 2, label: 'Semilunar', rects: [{ x: 0.2, y: 0, w: 0.1, h: 0.1 }] },
      ],
      explanation: '',
    },
  };
  const choice = {
    ...meta(),
    deckId: deck.id,
    topicId: null,
    origin: 'manual',
    content: {
      kind: 'multiple_choice',
      question: '=SUMA(1,1) ¿qué "nervio"?',
      options: ['Radial', 'Axilar', 'Mediano'],
      correct: 1,
      explanation: 'Línea 1\nLínea 2',
    },
  };
  const card = { ...meta(), noteId: choice.id, ordinal: 0, createdAt: T, lapseBaseline: 0 };
  const parsed = parseBackup({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: T,
    userId: newId(),
    entities: {
      deck: [deck],
      topic: [topic],
      note: [occlusion, choice],
      card: [card],
      exam: [{ ...meta(), title: 'Parcial', date: Date.UTC(2026, 10, 3, 6), topicIds: [topic.id] }],
      reviewLog: [
        {
          id: newId(),
          cardId: card.id,
          cardKind: 'multiple_choice',
          reviewedAt: T,
          rating: 3,
          durationMs: 4200,
          type: 'review',
          confidence: null,
          sessionId: newId(),
          deviceId: newId(),
        },
      ],
    },
  });
  if (!('backup' in parsed)) throw new Error('muestra inválida');
  return parsed.backup;
}

const BOM = String.fromCharCode(0xfeff);
const lines = (text: string) => text.slice(BOM.length).trimEnd().split('\r\n');

describe('planillas CSV del respaldo (QUALITY QA7)', () => {
  it('RFC 4180 con BOM: comillas, comas y saltos de línea entre comillas; fórmulas desactivadas', () => {
    const csv = toCsv(
      ['a', 'b', 'c'],
      [
        ['x, y', 'dijo "hola"', 'uno\ndos'],
        ['=1+1', -3, null],
      ],
    );
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toBe(BOM + 'a,b,c\r\n"x, y","dijo ""hola""","uno\ndos"\r\n\'=1+1,-3,\r\n');
  });

  it('una planilla por tabla, con nombres del modelo, pregunta y respuesta legibles y fechas en su zona', () => {
    const sheets = buildSpreadsheets(sample(), [], 'America/Mexico_City');
    expect(sheets.map((s) => s.name)).toEqual(['notes.csv', 'cards.csv', 'review_logs.csv', 'exams.csv']);
    const [notes, cards, logs, exams] = sheets.map((s) => lines(s.text));
    expect(notes?.[0]).toBe('id,deck,topic,kind,front,back,explanation');
    expect(notes?.[1]).toMatch(/,Mano,Carpo,image_occlusion,¿Qué hueso es\?,Escafoides \| Semilunar,$/);
    expect(notes?.[2]).toContain(`,Mano,,multiple_choice,"'=SUMA(1,1) ¿qué ""nervio""?",Axilar,"Línea 1`);
    expect(cards?.[1]).toContain(',0,2026-10-20 09:30:05,,,,,,'); // sin proyección, sin estado
    expect(logs?.[1]).toMatch(/,multiple_choice,2026-10-20 09:30:05,3,4200,review,$/);
    expect(exams?.[1]).toMatch(/,Parcial,2026-11-03,Carpo$/);
  });
});
