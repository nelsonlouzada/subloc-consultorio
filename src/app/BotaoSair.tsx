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
      className="btn btn-secondary btn-sm"
    >
      Sair
    </button>
  );
}
