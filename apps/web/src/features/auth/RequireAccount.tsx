import { Navigate, Outlet } from 'react-router';
import { useAccountUserId } from './queries';

/**
 * Local-first: si este dispositivo ya inició sesión alguna vez, la app abre aunque no haya
 * red ni token; la sync espera a que vuelva la sesión.
 */
export function RequireAccount() {
  const userId = useAccountUserId();
  if (userId === undefined) return null;
  if (userId === null) return <Navigate to="/login" replace />;
  return <Outlet />;
}
