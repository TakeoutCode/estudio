import catalog from '../../i18n/es/notifications.json' with { type: 'json' };

// NOTIFICATIONS NT6: los textos de los avisos salen de este catálogo (lo revisa `lint:copy`).
// Plurales con `_one`/`_other` como en la web.

type Key = keyof typeof catalog;
type WithoutPlural<K> = K extends `${infer B}_${'one' | 'other'}` ? B : K;
type Base = WithoutPlural<Key>;

const plural = new Intl.PluralRules('es');
const entries: Readonly<Record<string, string>> = catalog;

export function text(key: Base, params: Readonly<Record<string, string | number>> = {}): string {
  const count = params.count;
  const form = typeof count === 'number' ? entries[`${key}_${plural.select(count)}`] : undefined;
  const template = form ?? entries[key] ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''));
}

/** "A", "A y B", "A, B y C". */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${text('and')} ${items.at(-1) ?? ''}`;
}

/** NT6: "A, B y C" si están todos; si no, "A, B y 2 temas más", para no dar a entender que son todos. */
export function topicList(topics: readonly string[], more: number): string {
  return more > 0
    ? `${topics.join(', ')} ${text('and')} ${text('moreTopics', { count: more })}`
    : list(topics);
}

interface NamedTopics {
  readonly topics: readonly string[];
  /** Temas que no se nombran (`topicsInText`). */
  readonly more: number;
}

/** Lo que dice un recordatorio agrupado (NT5); se guarda con el evento para revisarlo (§6). */
export type ReminderParams = {
  readonly examSoon: readonly { readonly title: string; readonly days: number }[];
  readonly studyPlan: ({ readonly count: number } & NamedTopics) | null;
  readonly due: ({ readonly count: number } & NamedTopics) | null;
};

/** NT5: examen, plan y pendientes, en ese orden, en una sola línea. */
export function reminderBody(params: ReminderParams): string {
  const { studyPlan, due } = params;
  const parts = params.examSoon.map((e) => text('examSoon', { exam: e.title, count: e.days }));
  if (studyPlan) {
    parts.push(
      studyPlan.topics.length > 0
        ? text('studyPlan', { count: studyPlan.count, topics: topicList(studyPlan.topics, studyPlan.more) })
        : text('studyPlanNoTopic', { count: studyPlan.count }),
    );
  }
  if (due) {
    parts.push(
      due.topics.length > 0
        ? text('dueWithTopics', { count: due.count, topics: topicList(due.topics, due.more) })
        : text('due', { count: due.count }),
    );
  }
  return parts.join(' · ');
}
