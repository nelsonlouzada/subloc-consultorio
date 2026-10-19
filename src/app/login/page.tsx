'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const [erro, setErro] = useState<string | null>(
    params.get('erro') === 'acesso' ? 'Esta conta não tem acesso à área do Anfitrião.' : null,
  );
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    const dados = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(dados.get('email')),
      password: String(dados.get('senha')),
    });
    if (error) {
      setEnviando(false);
      setErro(
        error.code === 'EMAIL_NOT_VERIFIED'
          ? 'Confirme seu e-mail antes de entrar.'
          : error.status === 429
            ? 'Muitas tentativas. Aguarde um instante e tente de novo.'
            : 'E-mail ou senha incorretos.',
      );
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="space-y-4" noValidate>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base"
        />
      </div>
      <div>
        <label htmlFor="senha" className="mb-1 block text-sm font-medium">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base"
        />
      </div>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {erro}
      </p>
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-60"
      >
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

export default function Login() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Entrar</h1>
        <p className="mb-6 text-sm text-zinc-600">Acesso ao painel da sala.</p>
        <Suspense>
          <Formulario />
        </Suspense>
      </div>
    </main>
  );
}
