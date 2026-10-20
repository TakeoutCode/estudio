import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

// BE10: argon2id (el algoritmo por defecto de @node-rs/argon2) con el mínimo de OWASP.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, OPTIONS);

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/** Se verifica contra este hash cuando el correo no existe, para que el tiempo no lo delate. */
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(16).toString('hex')));
