'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Logo, IcChart, IcTrend, IcTimeline, IcMe, IcSwap, IcOff, IcImport, IcTeam, IcGear, IcBell, IcLog, IcOut, IcMenu, IcClose,
} from './icons';
import { initials } from '@/lib/names';
import { ROLE_LABEL, type Role } from '@/lib/types';

interface Props {
  me: { name: string; role: Role };
  orgName: string;
  isManager: boolean;
  isAdmin: boolean;
  counts: { requests: number; notifications: number };
}

export default function Sidebar({ me, orgName, isManager, counts }: Props) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);

  const link = (href: string, label: string, Icon: (p: object) => JSX.Element, badge?: number) => (
    <Link href={href} aria-current={path === href || path.startsWith(href + '/') ? 'page' : undefined}>
      <Icon />
      {label}
      {badge ? <span className="badge">{badge}</span> : null}
    </Link>
  );

  return (
    <>
      <div className="mobile-bar">
        <button className="btn btn-icon btn-ghost" aria-label="Apri menu" onClick={() => setOpen(true)}>
          <IcMenu />
        </button>
        <Logo />
        <span>{orgName}</span>
        {counts.requests + counts.notifications > 0 && (
          <span className="badge" style={{ marginLeft: 'auto' }}>{counts.requests + counts.notifications}</span>
        )}
      </div>
      <aside className={`side${open ? ' open' : ''}`}>
        <div className="side-logo">
          <Logo />
          <span style={{ flex: 1 }}>{orgName}</span>
          {open && (
            <button className="btn btn-icon btn-ghost btn-sm" aria-label="Chiudi menu" onClick={() => setOpen(false)}>
              <IcClose />
            </button>
          )}
        </div>
        <nav className="nav">
          {link('/timeline', 'Timeline', IcTimeline)}
          {link('/i-miei-turni', 'Il mio calendario', IcMe)}
          {link('/richieste', 'Richieste', IcSwap, counts.requests)}
          {link('/assenze', 'Tempo libero', IcOff)}
          {link('/notifiche', 'Notifiche', IcBell, counts.notifications)}
          {link('/impostazioni', 'Impostazioni', IcGear)}
          {isManager && (
            <div className="nav-group nav">
              <span className="label">Gestione</span>
              {link('/import', 'Importa Excel', IcImport)}
              {link('/team', 'Persone', IcTeam)}
              {link('/forecast', 'Forecast', IcTrend)}
              {link('/report', 'Report mensile', IcChart)}
              {link('/registro', 'Registro modifiche', IcLog)}
              {link('/configura', 'Configura', IcGear)}
            </div>
          )}
        </nav>
        <div className="side-foot">
          <span className="avatar">{initials(me.name)}</span>
          <div className="who">
            <b>{me.name}</b>
            <span>{ROLE_LABEL[me.role]}</span>
          </div>
          <form action="/auth/signout" method="post">
            <button className="btn btn-icon btn-ghost btn-sm" aria-label="Esci" title="Esci">
              <IcOut />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
