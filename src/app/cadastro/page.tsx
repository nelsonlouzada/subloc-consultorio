import Link from 'next/link';
import { redirect } from 'next/navigation';
import { paginaInicial, sessaoAtual } from '@/lib/sessao';
import { documentoVigente } from '@/modulos/configuracao/documentos-iniciais';
import FormularioCadastro from './FormularioCadastro';

export const metadata = { title: 'Cadastro de profissional' };

export default async function Cadastro() {
  const sessao = await sessaoAtual();
  if (sessao) redirect(paginaInicial(sessao.user.papel));

  const contrato = await documentoVigente('contrato');

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-8 text-zinc-900">
      <div className="w-full max-w-lg card p-8">
        <h1 className="mb-1 text-xl font-semibold">Cadastro de profissional</h1>
        <p className="mb-6 text-sm text-zinc-600">
          Para reservar a sala por hora, turno ou dia. Já tem conta?{' '}
          <Link href="/login" className="underline">
            Entrar
          </Link>
        </p>
        {contrato ? (
          <FormularioCadastro contrato={contrato.texto} versao={contrato.versao} />
        ) : (
          <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            O cadastro ainda não está disponível. Tente novamente em breve.
          </p>
        )}
      </div>
    </main>
  );
}
