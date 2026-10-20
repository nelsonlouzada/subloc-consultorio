'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

const MINIMO = 10;

function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!token || params.get('error')) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-red-700">
          Este link é inválido ou já expirou. Peça um novo.
        </p>
        <Link href="/esqueci-senha" className="block text-center text-sm font-medium underline">
          Pedir novo link
        </Link>
      </div>
    );
  }

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando || !token) return;
    const dados = new FormData(e.currentTarget);
    const senha = String(dados.get('senha'));
    if (senha.length < MINIMO) return setErro(`A senha precisa ter pelo menos ${MINIMO} caracteres.`);
    if (senha !== String(dados.get('confirmar'))) return setErro('As duas senhas não são iguais.');
    setErro(null);
    setEnviando(true);
    const { error } = await authClient.resetPassword({ newPassword: senha, token });
    if (error) {
      setEnviando(false);
      setErro(error.status === 400 ? 'Este link é inválido ou já expirou. Peça um novo.' : 'Não foi possível salvar a senha. Tente de novo.');
      return;
    }
    router.push('/login?aviso=senha_alterada');
  }

  const campo = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';
  return (
    <form onSubmit={salvar} className="space-y-4" noValidate>
      <div>
        <label htmlFor="senha" className="mb-1 block text-sm font-medium">
          Nova senha (mínimo de {MINIMO} caracteres)
        </label>
        <input id="senha" name="senha" type="password" autoComplete="new-password" required minLength={MINIMO} className={campo} />
      </div>
      <div>
        <label htmlFor="confirmar" className="mb-1 block text-sm font-medium">
          Repita a nova senha
        </label>
        <input id="confirmar" name="confirmar" type="password" autoComplete="new-password" required className={campo} />
      </div>
      <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
        {erro}
      </p>
      <button type="submit" disabled={enviando} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-60">
        {enviando ? 'Salvando…' : 'Salvar nova senha'}
      </button>
    </form>
  );
}

export default function RedefinirSenha() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold">Criar nova senha</h1>
        <Suspense>
          <Formulario />
        </Suspense>
      </div>
    </main>
  );
}
