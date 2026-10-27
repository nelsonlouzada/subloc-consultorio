import { exigirAnfitriao } from '@/lib/sessao';
import { estadoPagamento } from '@/modulos/configuracao/pagamento';

export const metadata = { title: 'Pagamento' };

function Linha({ ok, titulo, detalhe }: { ok: boolean; titulo: string; detalhe: string }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className={`mt-0.5 rounded-full px-2 py-0.5 text-xs ${ok ? 'bg-green-100 text-green-900' : 'bg-zinc-100 text-zinc-700'}`}>{ok ? 'Sim' : 'Não'}</span>
      <span>
        <strong className="block font-medium">{titulo}</strong>
        <span className="text-zinc-700">{detalhe}</span>
      </span>
    </li>
  );
}

export default async function Pagamento() {
  await exigirAnfitriao();
  const e = estadoPagamento();

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">
        Chaves e tokens ficam nas variáveis do serviço no Railway, nunca nesta tela. Aqui você só confere o que está configurado. Para mudar, edite as variáveis lá.
      </p>

      <section aria-label="Pix manual" className="card p-5 text-sm">
        <h2 className="text-lg font-semibold">Pix manual</h2>
        <ul className="divide-y divide-zinc-200">
          <Linha ok={e.pixManual.chaveConfigurada} titulo="Chave Pix configurada" detalhe="Mostrada ao profissional depois da aprovação, para ele pagar e você confirmar." />
          <Linha ok={Boolean(e.pixManual.favorecido)} titulo="Nome do favorecido" detalhe={e.pixManual.favorecido ?? 'Sem nome: o profissional vê só a chave.'} />
        </ul>
      </section>

      <section aria-label="Pix online (Asaas)" className="card p-5 text-sm">
        <h2 className="text-lg font-semibold">Pix online (Asaas)</h2>
        <ul className="divide-y divide-zinc-200">
          <Linha ok={e.asaas.ligado} titulo="Cobrança online ligada" detalhe={e.asaas.ligado ? 'O QR Code é gerado e o pagamento é confirmado sozinho.' : 'Desligada: vale o Pix manual.'} />
          <Linha ok={e.asaas.chaveConfigurada} titulo="Chave da API" detalhe={e.asaas.sandbox ? 'Ambiente de testes (sandbox).' : 'Ambiente de produção.'} />
          <Linha ok={e.asaas.tokenWebhookConfigurado} titulo="Token do webhook" detalhe="Confere que os avisos de pagamento vêm mesmo do Asaas." />
        </ul>
      </section>

      <section aria-label="Recibos" className="card p-5 text-sm">
        <h2 className="text-lg font-semibold">Recibos</h2>
        <ul className="divide-y divide-zinc-200">
          <Linha ok={Boolean(e.recibo.emitente)} titulo="Nome de quem emite" detalhe={e.recibo.emitente ?? 'Sem nome configurado.'} />
          <Linha ok={e.recibo.documentoConfigurado} titulo="CPF ou CNPJ do emitente" detalhe="Aparece no recibo em PDF." />
        </ul>
      </section>
    </div>
  );
}
