'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function BotaoSair() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push('/login');
        router.refresh();
      }}
      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
    >
      Sair
    </button>
  );
}
