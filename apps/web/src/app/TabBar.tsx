import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { CalendarIcon, CardsIcon, ChartIcon, HomeIcon, SlidersIcon } from '@/ui/icons';

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const TABS = [
  { to: '/', label: 'today.title', Icon: HomeIcon },
  { to: '/decks', label: 'decks.title', Icon: CardsIcon },
  { to: '/exams', label: 'exams.title', Icon: CalendarIcon },
  { to: '/dashboard', label: 'dashboard.title', Icon: ChartIcon },
  { to: '/settings', label: 'settings.title', Icon: SlidersIcon },
] as const;

const TAB_PATHS: ReadonlySet<string> = new Set(TABS.map((tab) => tab.to));

/** Las pantallas principales llevan pestañas; las de un flujo (estudiar, editar) no, para enfocarse. */
export const showsTabs = (pathname: string): boolean => TAB_PATHS.has(pathname.replace(/(.)\/$/, '$1'));

/**
 * UI-UX UX2: navegación principal abajo, en la zona del pulgar, por encima del indicador de
 * inicio. Cada pestaña mide al menos 56 px de alto y lleva ícono y texto (UX4).
 */
export function TabBar() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-20 bg-linear-to-t from-bg from-60% to-transparent px-[max(0.75rem,env(safe-area-inset-left))] pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <ul className="m-0 mx-auto flex max-w-md list-none gap-1 rounded-(--radius-card) bg-surface/95 p-1.5 shadow-bar backdrop-blur-md">
        {TABS.map(({ to, label, Icon }) => (
          <li key={to} className="min-w-0 flex-1">
            <NavLink
              to={to}
              end
              className={({ isActive }) =>
                `press flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-(--radius-card) px-0.5 text-micro leading-tight font-bold ${isActive ? 'bg-blush text-primary' : 'text-muted'} ${focus}`
              }
            >
              <Icon className="size-6 shrink-0" />
              <span className="max-w-full text-center wrap-break-word">{t(label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
