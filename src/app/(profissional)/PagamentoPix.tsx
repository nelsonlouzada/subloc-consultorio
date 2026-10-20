import { formatarReais } from '@/lib/dinheiro';

/** Pagamento online (T12): QR Code, Pix copia e cola e, para cartão, a página de fatura do Asaas. */
export default function PagamentoPix({
  valorCentavos,
  copiaCola,
  qrImagem,
  faturaUrl,
}: {
  valorCentavos: number;
  copiaCola: string;
  qrImagem: string | null;
  faturaUrl: string | null;
}) {
  return (
    <div className="space-y-3">
      <p>
        Valor: <strong>{formatarReais(valorCentavos)}</strong>
      </p>
      <div className="flex flex-wrap items-start gap-4">
        {qrImagem && (
          // eslint-disable-next-line @next/next/no-img-element -- imagem em base64 vinda do Asaas
          <img src={`data:image/png;base64,${qrImagem}`} alt="QR Code do Pix" width={176} height={176} className="rounded-lg border border-zinc-200 bg-white p-1" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">Pix copia e cola</p>
          <p className="select-all break-all rounded-lg border border-zinc-300 bg-white p-2 font-mono text-xs">{copiaCola}</p>
          <p className="text-xs text-zinc-600">Toque no código para selecionar, copie e cole no app do seu banco.</p>
        </div>
      </div>
      {faturaUrl && (
        <p>
          Prefere cartão?{' '}
          <a href={faturaUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Pagar pela página segura do Asaas
          </a>
        </p>
      )}
      <p className="text-xs text-zinc-600">Assim que o pagamento é reconhecido, a confirmação é automática e você recebe um e-mail.</p>
    </div>
  );
}
