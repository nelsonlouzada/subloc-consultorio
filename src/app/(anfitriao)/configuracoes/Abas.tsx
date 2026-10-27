'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ABAS = [
  ['/configuracoes', 'Regras e prazos'],
  ['/configuracoes/precos', 'Preços'],
  ['/configuracoes/turnos', 'Turnos'],
] as const;

export default function Abas() {
  const atual = usePathname();
  return (
    <nav aria-label="Configurações" className="flex flex-wrap gap-1">
      {ABAS.map(([href, nome]) => (
        <Link key={href} href={href} aria-current={atual === href ? 'page' : undefined} className="nav-link">
          {nome}
        </Link>
      ))}
    </nav>
  );
}
