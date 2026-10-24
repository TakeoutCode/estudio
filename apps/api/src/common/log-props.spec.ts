import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { requestLogProps } from './log-props.js';

const request = (user?: object) => ({ headers: {}, user }) as unknown as IncomingMessage;

describe('requestLogProps (BACKEND BE6)', () => {
  it('BE6: con sesión agrega solo su userId; sin sesión, nada', () => {
    const userId = '0192f1a0-0000-7000-8000-000000000001';
    expect(requestLogProps(request({ id: userId, email: 'ella@ejemplo.mx' }))).toEqual({ userId });
    expect(requestLogProps(request())).toEqual({});
    expect(requestLogProps(request({}))).toEqual({});
  });
});
