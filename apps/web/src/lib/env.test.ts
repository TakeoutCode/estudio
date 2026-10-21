import { describe, expect, it } from 'vitest';
import { parseWebEnv } from './env';

describe('parseWebEnv (FRONTEND FE5)', () => {
  it('acepta la URL de la API e ignora las variables de Vite que no son VITE_', () => {
    expect(parseWebEnv({ VITE_API_URL: 'https://api.ejemplo.mx', MODE: 'production', DEV: false })).toEqual({
      VITE_API_URL: 'https://api.ejemplo.mx',
    });
  });

  it('trata las variables vacías como ausentes', () => {
    expect(parseWebEnv({ VITE_API_URL: 'http://localhost:3000', VITE_VAPID_PUBLIC_KEY: '' })).toEqual({
      VITE_API_URL: 'http://localhost:3000',
    });
  });

  it('falla sin VITE_API_URL', () => {
    expect(() => parseWebEnv({})).toThrow();
  });

  it('FE8: la nube de Cloudinary es opcional, pero solo con letras, números, guion y guion bajo', () => {
    const api = { VITE_API_URL: 'https://api.ejemplo.mx' };
    expect(parseWebEnv({ ...api, VITE_CLOUDINARY_CLOUD_NAME: 'mi-nube' })).toEqual({
      ...api,
      VITE_CLOUDINARY_CLOUD_NAME: 'mi-nube',
    });
    expect(() => parseWebEnv({ ...api, VITE_CLOUDINARY_CLOUD_NAME: 'mi nube/../x' })).toThrow();
  });

  it('AGENTS §5: rechaza cualquier otra VITE_*, porque terminaría en el bundle público', () => {
    expect(() => parseWebEnv({ VITE_API_URL: 'http://localhost:3000', VITE_OPENAI_API_KEY: 'sk-x' })).toThrow(
      'VITE_OPENAI_API_KEY',
    );
  });
});
