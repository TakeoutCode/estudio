import { type ApiErrorCode, CONTRACT_HEADER, CONTRACT_VERSION, ProblemDetailsSchema } from '@estudio/shared';
import type { z } from 'zod';

/** Error de la API con su código estable (BACKEND BE5); la UI lo traduce con i18n. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'network',
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface ApiClientDeps {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
  getAccessToken(): string | null;
  /** Renueva la sesión con la cookie; `true` si hay un access token nuevo. */
  refresh(): Promise<boolean>;
  /** ARC6: la API pide una versión más nueva de la app. */
  onContractOutdated(): void;
}

export interface RequestOptions<T> {
  readonly method?: 'GET' | 'POST';
  readonly body?: unknown;
  readonly schema: z.ZodType<T>;
  /** `false` en los endpoints de auth: sin Bearer y sin reintento por 401. */
  readonly auth?: boolean;
}

export type ApiClient = <T>(path: string, options: RequestOptions<T>) => Promise<T>;

async function toApiError(res: Response): Promise<ApiError> {
  const retryAfter = Number(res.headers.get('retry-after'));
  const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
  try {
    const problem = ProblemDetailsSchema.safeParse(await res.json());
    if (problem.success) return new ApiError(res.status, problem.data.code, retryAfterMs);
  } catch {
    // Cuerpo que no es problem+json (proxy, HTML de error).
  }
  return new ApiError(res.status, res.status >= 500 ? 'internal' : 'validation_failed', retryAfterMs);
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const send = async <T>(path: string, options: RequestOptions<T>, retried: boolean): Promise<T> => {
    const headers: Record<string, string> = { [CONTRACT_HEADER]: String(CONTRACT_VERSION) };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const token = options.auth === false ? null : deps.getAccessToken();
    if (token) headers.authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await deps.fetch(`${deps.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: 'include', // la cookie de refresh viaja solo a /auth (Path=/auth)
      });
    } catch {
      throw new ApiError(0, 'network');
    }

    if (res.status === 401 && options.auth !== false && !retried && (await deps.refresh())) {
      return send(path, options, true);
    }
    if (res.status === 426) deps.onContractOutdated();
    if (!res.ok) throw await toApiError(res);
    if (res.status === 202 || res.status === 204) {
      await res.text(); // vaciar el cuerpo: si no, el navegador corta la conexión (ERR_ABORTED)
      return options.schema.parse(undefined);
    }
    return options.schema.parse(await res.json());
  };
  return (path, options) => send(path, options, false);
}
