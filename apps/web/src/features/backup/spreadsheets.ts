import type { Backup, Note, NoteContent } from '@estudio/shared';
import type { CardState } from '@estudio/srs';

// QUALITY QA7: una planilla por tabla (notes, cards, review_logs, exams) para abrir en Excel o
// Sheets. Columnas con el nombre del modelo de datos; fechas en su zona horaria (AG6).

type Cell = string | number | null;

/** OWASP: un texto que empieza así se ejecutaría como fórmula al abrir la planilla. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Marca de orden de bytes: así Excel reconoce UTF-8 y muestra bien los acentos. */
const BOM = String.fromCharCode(0xfeff);

/** RFC 4180 con BOM. */
export function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return `${BOM}${[header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

const dateTimeIn = (timeZone: string) => {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return (ms: number | null) => (ms === null ? null : format.format(ms));
};

const dateIn = (timeZone: string) => {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return (ms: number) => format.format(ms);
};

/** Pregunta y respuesta legibles de cada tipo de nota (LD §1). */
function faces(content: NoteContent): readonly [string, string] {
  switch (content.kind) {
    case 'basic':
    case 'type_answer':
      return [content.front, content.back];
    case 'cloze':
      return [content.text, ''];
    case 'multiple_choice':
      return [content.question, content.options[content.correct] ?? ''];
    case 'image_occlusion':
      return [content.prompt, content.groups.map((g) => g.label).join(' | ')];
    case 'true_false_justify':
      return [content.statement, content.justification];
    case 'open_question':
      return [content.question, content.key];
  }
}

export function buildSpreadsheets(
  backup: Backup,
  cardStates: readonly CardState[],
  timeZone: string,
): { readonly name: string; readonly text: string }[] {
  const { entities } = backup;
  const at = dateTimeIn(timeZone);
  const day = dateIn(timeZone);
  const decks = new Map(entities.deck.map((d) => [d.id, d.name]));
  const topics = new Map(entities.topic.map((t) => [t.id, t.name]));
  const states = new Map(cardStates.map((s) => [s.cardId, s]));

  const noteRow = (note: Note): Cell[] => [
    note.id,
    decks.get(note.deckId) ?? null,
    note.topicId === null ? null : (topics.get(note.topicId) ?? null),
    note.content.kind,
    ...faces(note.content),
    note.content.explanation,
  ];
  return [
    {
      name: 'notes.csv',
      text: toCsv(
        ['id', 'deck', 'topic', 'kind', 'front', 'back', 'explanation'],
        entities.note.map(noteRow),
      ),
    },
    {
      name: 'cards.csv',
      text: toCsv(
        [
          'id',
          'note_id',
          'ordinal',
          'created_at',
          'phase',
          'due',
          'stability',
          'difficulty',
          'reps',
          'lapses',
        ],
        entities.card.map((card) => {
          const state = states.get(card.id);
          return [
            card.id,
            card.noteId,
            card.ordinal,
            at(card.createdAt),
            state?.phase ?? null,
            state ? at(state.due) : null,
            state?.stability ?? null,
            state?.difficulty ?? null,
            state?.reps ?? null,
            state?.lapses ?? null,
          ];
        }),
      ),
    },
    {
      name: 'review_logs.csv',
      text: toCsv(
        ['id', 'card_id', 'card_kind', 'reviewed_at', 'rating', 'duration_ms', 'type', 'confidence'],
        [...entities.reviewLog]
          .sort((a, b) => a.reviewedAt - b.reviewedAt)
          .map((log) => [
            log.id,
            log.cardId,
            log.cardKind,
            at(log.reviewedAt),
            log.rating,
            log.durationMs,
            log.type,
            log.confidence,
          ]),
      ),
    },
    {
      name: 'exams.csv',
      text: toCsv(
        ['id', 'title', 'date', 'topics'],
        entities.exam.map((exam) => [
          exam.id,
          exam.title,
          day(exam.date),
          exam.topicIds.map((id) => topics.get(id) ?? id).join(' | '),
        ]),
      ),
    },
  ];
}
