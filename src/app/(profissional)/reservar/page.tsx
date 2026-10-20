import { exigirProfissional } from '@/lib/sessao';

export const metadata = { title: 'Reservar a sala' };

// T10 chega no bloco C da E2. Até lá, a área do Profissional só mostra o estado do cadastro.
export default async function Reservar() {
  const { sessao } = await exigirProfissional();
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Olá, {sessao.user.name.split(' ')[0]}</h1>
      <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
        A escolha de horários para reservar a sala estará disponível em breve.
      </p>
    </div>
  );
}
