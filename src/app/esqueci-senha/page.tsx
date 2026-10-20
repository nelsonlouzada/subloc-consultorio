'use client';

import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function EsqueciSenha() {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function pedir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    const email = String(new FormData(e.currentTarget).get('email')).trim();
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: '/redefinir-senha' });
    setEnviando(false);
    // A resposta é a mesma exista ou não a conta, para não revelar quem tem cadastro.
    if (error && error.status === 429) {
      setErro('Muitas tentativas. Aguarde um instante e tente de novo.');
      return;
    }
    setEnviado(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Esqueci minha senha</h1>
        {enviado ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-zinc-700">
              Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora. Confira também a caixa de spam.
            </p>
            <Link href="/login" className="block text-center text-sm font-medium underline">
              Voltar para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={pedir} className="space-y-4" noValidate>
            <p className="text-sm text-zinc-600">Informe o e-mail do seu cadastro.</p>
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium">
                E-mail
              </label>
              <input id="email" name="email" type="email" autoComplete="email" required className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base" />
            </div>
            <p role="alert" aria-live="polite" className="min-h-5 text-sm text-red-700">
              {erro}
            </p>
            <button type="submit" disabled={enviando} className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-60">
              {enviando ? 'Enviando…' : 'Enviar link'}
            </button>
            <Link href="/login" className="block text-center text-sm underline">
              Voltar para o login
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
