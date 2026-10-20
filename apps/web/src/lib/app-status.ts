import { create } from 'zustand';

/** Estado global efímero de la app (FRONTEND FE2). */
interface AppStatusState {
  /** ARC6: la API respondió 426; la sync se pausa hasta actualizar la PWA. */
  readonly contractOutdated: boolean;
  markContractOutdated(): void;
}

export const useAppStatus = create<AppStatusState>()((set) => ({
  contractOutdated: false,
  markContractOutdated: () => {
    set({ contractOutdated: true });
  },
}));
