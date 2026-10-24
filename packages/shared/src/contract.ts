/**
 * Versión del contrato cliente-servidor (ARCHITECTURE ARC6). Se sube cuando cambia la
 * forma de lo que viaja por HTTP o sync; la API responde 426 a clientes por debajo de
 * su mínimo soportado.
 */
export const CONTRACT_VERSION = 26; // 4: TimerBlockLog.extended (§5) · 5: Topic y SelfExplanation (LD5) · 6: Exam (R11) · 7: StudySession (simulacros, P7) · 8: notas cloze, type_answer y multiple_choice (LD §1) · 9: Deck.pausedAt · 10: MediaAsset (FE8) y notas image_occlusion (R10) · 11: ContrastGroup (R9, LD10) · 12: SleepLog (§5) · 13: Tag y Note.tagIds · 14: ejercicios true_false_justify y open_question (LD §2) · 15: ejercicio sequence · 16: ejercicio matching · 17: ejercicio label_image · 18: ejercicio clinical_case · 19: Reward y RewardRedemption (UX10) · 20: POST /diagnostics/errors (FE13) · 21: Note.mnemonic (R14) · 22: AiDraft y POST /ai/drafts (LD14-17) · 23: AiFeedback y POST /ai/feedback · 24: AiDraft de casos clínicos y distractores, POST /ai/clinical-cases y POST /ai/distractors · 25: SelfExplanation.kind y gaps ("Explícaselo a alguien") · 26: UserSettings.profile.fewerNewAnsweredAt (P3)

/**
 * ARC6, SY1: el contrato más viejo que puede escribir sin borrar datos; la API lo exige además de
 * `MIN_CONTRACT`. La sync es LWW por fila entera: un cliente que no conoce un campo nuevo de una
 * entidad LWW (o de una sección de UserSettings) lo omite al editarla, el servidor aplica su
 * default y pisa lo que escribió otro dispositivo. Agregar un campo así lo sube junto con
 * `CONTRACT_VERSION` (la prueba `lww-fields` lo recuerda); una entidad o ruta nueva, no.
 */
export const MIN_SAFE_CONTRACT = 26; // 26: profile.fewerNewAnsweredAt · 25: SelfExplanation.kind y gaps · 21: Note.mnemonic · 13: Note.tagIds

/** Cabecera que el cliente envía en cada request (en minúsculas, como la normaliza Node). */
export const CONTRACT_HEADER = 'x-estudio-contract';
