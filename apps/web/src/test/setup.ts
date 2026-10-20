import 'fake-indexeddb/auto';
import '@/lib/i18n';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
