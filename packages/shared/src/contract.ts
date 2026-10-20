/**
 * Versión del contrato cliente-servidor (ARCHITECTURE ARC6). Se sube cuando cambia la
 * forma de lo que viaja por HTTP o sync; la API responde 426 a clientes por debajo de
 * su mínimo soportado.
 */
export const CONTRACT_VERSION = 9; // 4: TimerBlockLog.extended (§5) · 5: Topic y SelfExplanation (LD5) · 6: Exam (R11) · 7: StudySession (simulacros, P7) · 8: notas cloze, type_answer y multiple_choice (LD §1) · 9: Deck.pausedAt

/** Cabecera que el cliente envía en cada request (en minúsculas, como la normaliza Node). */
export const CONTRACT_HEADER = 'x-estudio-contract';
