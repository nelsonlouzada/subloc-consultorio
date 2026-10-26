import Link from 'next/link';

export const metadata = { title: 'Página não encontrada' };

export default function NaoEncontrada() {
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight">Página não encontrada</h1>
      <p className="text-zinc-700">O endereço não existe ou você não tem acesso a ele.</p>
      <Link href="/" className="btn btn-primary inline-block">
        Voltar ao início
      </Link>
    </main>
  );
}
