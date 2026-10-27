import { exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { salaParaTela, TEXTO_ERRO_SALA } from '@/modulos/configuracao/sala';
import { salvarSalaAction } from './actions';

export const metadata = { title: 'Sala e página' };

const AVISOS: Record<string, string> = {
  salvo: 'Dados da sala salvos.',
  sem_mudanca: 'Nada mudou.',
};
const campo = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';

function Texto({ nome, rotulo, valor, largura = 'w-full', maximo }: { nome: string; rotulo: string; valor: string | null; largura?: string; maximo: number }) {
  return (
    <div className={largura}>
      <label htmlFor={nome} className="mb-1 block text-sm font-medium">
        {rotulo}
      </label>
      <input id={nome} name={nome} maxLength={maximo} defaultValue={valor ?? ''} className={campo} />
    </div>
  );
}

export default async function SalaEPagina({ searchParams }: { searchParams: Promise<{ aviso?: string; erro?: string }> }) {
  await exigirAnfitriao();
  const { aviso, erro } = await searchParams;
  const sala = await carregarSala();
  if (!sala) return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada.</p>;
  const s = salaParaTela(sala.espaco);

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">Estes dados aparecem na página pública da sala. As fotos entram junto com a página pública.</p>

      {aviso && AVISOS[aviso] && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {AVISOS[aviso]}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_SALA[erro] ?? TEXTO_ERRO_SALA.invalido}
        </p>
      )}

      <form action={salvarSalaAction} className="space-y-6">
        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Apresentação</legend>
          <Texto nome="nome" rotulo="Nome da sala" valor={s.nome} maximo={80} />
          <div>
            <label htmlFor="descricao" className="mb-1 block text-sm font-medium">
              Descrição
            </label>
            <textarea id="descricao" name="descricao" rows={4} maxLength={1000} defaultValue={s.descricao ?? ''} className={campo} />
          </div>
          <div>
            <label htmlFor="comodidades" className="mb-1 block text-sm font-medium">
              O que está incluso (uma por linha)
            </label>
            <textarea id="comodidades" name="comodidades" rows={5} defaultValue={s.comodidades.join('\n')} className={campo} />
          </div>
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Endereço</legend>
          <div className="flex flex-wrap gap-4">
            <Texto nome="logradouro" rotulo="Rua" valor={s.logradouro} largura="min-w-0 flex-[3]" maximo={120} />
            <Texto nome="numero" rotulo="Número" valor={s.numero} largura="w-28" maximo={20} />
          </div>
          <div className="flex flex-wrap gap-4">
            <Texto nome="complemento" rotulo="Complemento" valor={s.complemento} largura="min-w-0 flex-1" maximo={60} />
            <Texto nome="bairro" rotulo="Bairro" valor={s.bairro} largura="min-w-0 flex-1" maximo={60} />
          </div>
          <div className="flex flex-wrap gap-4">
            <Texto nome="cidade" rotulo="Cidade" valor={s.cidade} largura="min-w-0 flex-[2]" maximo={60} />
            <Texto nome="uf" rotulo="UF" valor={s.uf} largura="w-20" maximo={2} />
            <Texto nome="cep" rotulo="CEP" valor={s.cep} largura="w-36" maximo={9} />
          </div>
        </fieldset>

        <button type="submit" className="btn btn-primary">
          Salvar a sala
        </button>
      </form>
    </div>
  );
}
