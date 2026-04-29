import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useMe } from '../hooks/useMe.js';
import { ImpersonationSwitcher } from './ImpersonationSwitcher.jsx';

export function AppShell() {
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 15_000,
  });
  const { data: me } = useMe();

  const isPatient = me?.role === 'patient';
  const homeHref = isPatient && me?.sub ? `/patients/${me.sub}` : '/patients';
  const title = isPatient ? 'My health record' : 'Patient Memory Layer';
  const subtitle = isPatient
    ? 'Your longitudinal record · grant access · review who saw what'
    : 'Longitudinal record · agent-synthesized context';

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-clinical-border bg-clinical-panel/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between">
          <Link to={homeHref} className="flex items-center gap-2">
            <span className="h-7 w-7 rounded-md bg-clinical-accent/20 border border-clinical-accent/40 flex items-center justify-center">
              <span className="text-clinical-accent font-bold text-sm">P</span>
            </span>
            <div className="leading-tight">
              <div className="font-semibold">{title}</div>
              <div className="text-xs text-slate-400">{subtitle}</div>
            </div>
          </Link>

          <nav className="flex items-center gap-2 text-sm">
            {!isPatient && (
              <NavLink
                to="/patients"
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md ${isActive ? 'bg-clinical-accent/10 text-clinical-accent' : 'text-slate-300 hover:text-white'}`
                }
              >
                Patients
              </NavLink>
            )}
            {isPatient && me?.sub && (
              <NavLink
                to={`/patients/${me.sub}`}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-md ${isActive ? 'bg-clinical-accent/10 text-clinical-accent' : 'text-slate-300 hover:text-white'}`
                }
              >
                My record
              </NavLink>
            )}
            <ImpersonationSwitcher />
            <HealthDot status={health} />
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Outlet />
        </div>
      </main>

      <footer className="border-t border-clinical-border py-3">
        <div className="mx-auto max-w-7xl px-6 text-xs text-slate-500 flex items-center justify-between">
          <span>PML · MVP scaffold</span>
          <span>FHIR R4 · MongoDB · Claude agents</span>
        </div>
      </footer>
    </div>
  );
}

function HealthDot({ status }) {
  const ok = status?.status === 'ok' && status?.mongo === 'connected';
  return (
    <span
      title={status ? `mongo: ${status.mongo}` : 'checking...'}
      className={`h-2 w-2 rounded-full ${ok ? 'bg-clinical-ok' : 'bg-clinical-danger'} ml-2`}
    />
  );
}
