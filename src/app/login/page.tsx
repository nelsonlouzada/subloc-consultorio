'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { DESTINO_APOS_CONFIRMAR } from '@/lib/confirmacao';

function Formulario() {
  const router = useRouter();
  const params = useSearchParams();
  const [erro, setErro] = useState<string | null>(
    params.get('erro') === 'acesso' ? 'Esta conta não tem acesso à área do Anfitrião.' : null,
  );
  const [enviando, setEnviando] = useState(false);
  // E-mail de quem tentou entrar sem confirmar o endereço: habilita o botão de reenviar o link.
  const [naoConfirmado, setNaoConfirmado] = useState<string | null>(null);
  const [reenvio, setReenvio] = useState<'ocioso' | 'enviando' | 'enviado' | 'falhou'>('ocioso');

  async function entrar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setNaoConfirmado(null);
    setReenvio('ocioso');
    setEnviando(true);
    const dados = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(dados.get('email')),
      password: String(dados.get('senha')),
    });
    if (error) {
      setEnviando(false);
      if (error.code === 'EMAIL_NOT_VERIFIED') setNaoConfirmado(String(dados.get('email')));
      setErro(
        error.code === 'EMAIL_NOT_VERIFIED'
          ? 'Confirme seu e-mail antes de entrar. Enviamos um novo link para o seu endereço (confira também a caixa de spam).'
          : error.status === 429
            ? 'Muitas tentativas. Aguarde um instante e tente de novo.'
            : 'E-mail ou senha incorretos.',
      );
      return;
    }
    router.push('/');
    router.refresh();
  }

  async function reenviar() {
    if (!naoConfirmado || reenvio === 'enviando') return;
    setReenvio('enviando');
    const { error } = await authClient.sendVerificationEmail({ email: naoConfirmado, callbackURL: DESTINO_APOS_CONFIRMAR });
    setReenvio(error ? 'falhou' : 'enviado');
  }

  return (
    <form onSubmit={entrar} className="space-y-5" noValidate>
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
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
        <label htmlFor="senha" className="mb-1.5 block text-sm font-medium">
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
      {naoConfirmado && (
        <div className="space-y-1 text-sm">
          <button type="button" onClick={reenviar} disabled={reenvio === 'enviando' || reenvio === 'enviado'} className="underline disabled:opacity-60">
            {reenvio === 'enviando' ? 'Reenviando…' : 'Reenviar e-mail de confirmação'}
          </button>
          {reenvio === 'enviado' && <p role="status">Pronto: o link novo foi enviado para {naoConfirmado}.</p>}
          {reenvio === 'falhou' && <p role="alert" className="text-red-700">Não foi possível reenviar agora. Tente de novo em instantes.</p>}
        </div>
      )}
      {params.get('aviso') === 'email_confirmado' && (
        <p role="status" className="text-sm text-green-800">
          E-mail confirmado. Entre com o seu e-mail e a sua senha.
        </p>
      )}
      {params.get('aviso') === 'senha_alterada' && (
        <p role="status" className="text-sm text-green-800">
          Senha alterada. Entre com a nova senha.
        </p>
      )}
      <p className="text-right text-sm">
        <Link href="/esqueci-senha" className="underline">
          Esqueci minha senha
        </Link>
      </p>
      <button
        type="submit"
        disabled={enviando}
        className="w-full btn btn-primary disabled:opacity-60"
      >
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

export default function Login() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900">
      <div className="w-full max-w-sm card p-8">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Entrar</h1>
        <p className="mb-8 text-zinc-600">Acesso ao painel da sala.</p>
        <Suspense>
          <Formulario />
        </Suspense>
        <p className="mt-6 border-t border-zinc-200 pt-4 text-center text-sm text-zinc-600">
          É profissional e quer reservar a sala?{' '}
          <Link href="/cadastro" className="font-medium text-zinc-900 underline">
            Cadastre-se
          </Link>
        </p>
      </div>
    </main>
  );
}
