/**
 * Versión del contrato cliente-servidor (ARCHITECTURE ARC6). Se sube cuando cambia la
 * forma de lo que viaja por HTTP o sync; la API responde 426 a clientes por debajo de
 * su mínimo soportado.
 */
export const CONTRACT_VERSION = 20; // 4: TimerBlockLog.extended (§5) · 5: Topic y SelfExplanation (LD5) · 6: Exam (R11) · 7: StudySession (simulacros, P7) · 8: notas cloze, type_answer y multiple_choice (LD §1) · 9: Deck.pausedAt · 10: MediaAsset (FE8) y notas image_occlusion (R10) · 11: ContrastGroup (R9, LD10) · 12: SleepLog (§5) · 13: Tag y Note.tagIds · 14: ejercicios true_false_justify y open_question (LD §2) · 15: ejercicio sequence · 16: ejercicio matching · 17: ejercicio label_image · 18: ejercicio clinical_case · 19: Reward y RewardRedemption (UX10) · 20: POST /diagnostics/errors (FE13)

/** Cabecera que el cliente envía en cada request (en minúsculas, como la normaliza Node). */
export const CONTRACT_HEADER = 'x-estudio-contract';
