/**
 * Versión del contrato cliente-servidor (ARCHITECTURE ARC6). Se sube cuando cambia la
 * forma de lo que viaja por HTTP o sync; la API responde 426 a clientes por debajo de
 * su mínimo soportado.
 */
export const CONTRACT_VERSION = 3;

/** Cabecera que el cliente envía en cada request (en minúsculas, como la normaliza Node). */
export const CONTRACT_HEADER = 'x-estudio-contract';
