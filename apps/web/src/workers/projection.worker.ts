import '../lib/zod-config';
import { expose } from 'comlink';
import { projectionApi } from './projection-api';

// FRONTEND FE4: replay completo y carga proyectada fuera del hilo principal.
expose(projectionApi);
