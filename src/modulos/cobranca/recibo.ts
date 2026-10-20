import * as Sentry from '@sentry/node';
import { eq } from 'drizzle-orm';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';

/**
 * Emite o recibo de uma cobrança paga, uma única vez (o número é sequencial e nunca se repete).
 * Cobrança sem dinheiro recebido (paga só com crédito) não tem recibo: o crédito já tinha sido
 * recebido, e recebeu o seu recibo na compra. Chamar de novo devolve o mesmo recibo.
 */
export async function emitirRecibo(cobrancaId: string): Promise<{ id: string; numero: number } | null> {
  const [c] = await db.select().from(schema.cobranca).where(eq(schema.cobranca.id, cobrancaId));
  if (!c || c.status !== 'paga' || c.valorCobradoCentavos <= 0) return null;
  await db.insert(schema.recibo).values({ cobrancaId }).onConflictDoNothing({ target: schema.recibo.cobrancaId });
  const [r] = await db.select({ id: schema.recibo.id, numero: schema.recibo.numero }).from(schema.recibo).where(eq(schema.recibo.cobrancaId, cobrancaId));
  return r ?? null;
}

/** Emite o recibo sem nunca derrubar quem chamou: o pagamento já valeu, e a tela de recibo emite de novo se faltar. */
export async function emitirReciboSemFalhar(cobrancaId: string): Promise<void> {
  try {
    await emitirRecibo(cobrancaId);
  } catch (e) {
    Sentry.captureException(e, { tags: { fluxo: 'recibo' } });
  }
}

export type DadosRecibo = {
  numero: number;
  emitidoEm: Date;
  pagador: { nome: string; cpf: string };
  espaco: string;
  itens: string[];
  valorPagoCentavos: number;
  creditoUsadoCentavos: number;
  meio: string;
  pagoEm: Date | null;
  profissionalId: string;
};

const MEIOS: Record<string, string> = { pix: 'Pix', cartao: 'Cartão de crédito', pix_manual: 'Pix (conferido pelos responsáveis)', credito: 'Crédito da carteira' };

export async function carregarRecibo(reciboId: string): Promise<DadosRecibo | null> {
  const [r] = await db
    .select({
      numero: schema.recibo.numero,
      emitidoEm: schema.recibo.emitidoEm,
      cobrancaId: schema.cobranca.id,
      profissionalId: schema.cobranca.profissionalId,
      valorPagoCentavos: schema.cobranca.valorCobradoCentavos,
      creditoUsadoCentavos: schema.cobranca.creditoUsadoCentavos,
      meio: schema.cobranca.meio,
      pagoEm: schema.cobranca.pagoEm,
      nome: schema.usuario.name,
      cpf: schema.profissional.cpf,
    })
    .from(schema.recibo)
    .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.recibo.cobrancaId))
    .innerJoin(schema.profissional, eq(schema.profissional.usuarioId, schema.cobranca.profissionalId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(eq(schema.recibo.id, reciboId));
  if (!r) return null;

  const itens = await db
    .select({
      inicio: schema.reserva.inicio,
      fim: schema.reserva.fim,
      pacote: schema.pacoteCredito.nome,
      credito: schema.pacoteCredito.valorCreditoCentavos,
      espaco: schema.espaco.nome,
    })
    .from(schema.cobrancaItem)
    .leftJoin(schema.reserva, eq(schema.reserva.id, schema.cobrancaItem.reservaId))
    .leftJoin(schema.pacoteCredito, eq(schema.pacoteCredito.id, schema.cobrancaItem.pacoteCreditoId))
    .leftJoin(schema.espaco, eq(schema.espaco.id, schema.pacoteCredito.espacoId))
    .where(eq(schema.cobrancaItem.cobrancaId, r.cobrancaId));

  const [sala] = await db.select({ nome: schema.espaco.nome }).from(schema.espaco).limit(1);
  return {
    numero: r.numero,
    emitidoEm: r.emitidoEm,
    pagador: { nome: r.nome, cpf: r.cpf },
    espaco: itens.find((i) => i.espaco)?.espaco ?? sala?.nome ?? 'Sala',
    itens: itens.map((i) =>
      i.inicio && i.fim ? `Reserva da sala: ${descreverPeriodo(i.inicio, i.fim)}` : `Banco de horas: ${i.pacote} (${formatarReais(i.credito ?? 0)} em crédito)`,
    ),
    valorPagoCentavos: r.valorPagoCentavos,
    creditoUsadoCentavos: r.creditoUsadoCentavos,
    meio: MEIOS[r.meio ?? ''] ?? '—',
    pagoEm: r.pagoEm,
    profissionalId: r.profissionalId,
  };
}

const cpfMascarado = (cpf: string) => `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

/**
 * Gera o PDF do recibo na hora, a partir dos dados. Não é nota fiscal: serve de comprovante do
 * pagamento. Quem emite (nome e documento) vem de RECIBO_EMITENTE_NOME / RECIBO_EMITENTE_DOC, e só
 * aparece se estiver configurado, para o sistema nunca inventar um dado fiscal.
 */
export async function gerarPdfRecibo(d: DadosRecibo): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([595, 842]); // A4
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cinza = rgb(0.4, 0.4, 0.4);

  let y = 780;
  const linha = (texto: string, opc: { negrito?: boolean; tamanho?: number; cor?: ReturnType<typeof rgb> } = {}) => {
    const tamanho = opc.tamanho ?? 11;
    // Quebra simples por largura, para itens longos não saírem da página.
    const f = opc.negrito ? negrito : fonte;
    const palavras = texto.split(' ');
    let atual = '';
    for (const palavra of palavras) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra;
      if (f.widthOfTextAtSize(tentativa, tamanho) > 480 && atual) {
        pagina.drawText(atual, { x: 57, y, size: tamanho, font: f, color: opc.cor ?? rgb(0, 0, 0) });
        y -= tamanho + 5;
        atual = palavra;
      } else atual = tentativa;
    }
    pagina.drawText(atual, { x: 57, y, size: tamanho, font: f, color: opc.cor ?? rgb(0, 0, 0) });
    y -= tamanho + 7;
  };

  linha(d.espaco, { negrito: true, tamanho: 18 });
  linha(`Recibo nº ${String(d.numero).padStart(6, '0')}`, { negrito: true, tamanho: 14 });
  linha(`Emitido em ${descreverMomento(d.emitidoEm)}`, { cor: cinza, tamanho: 10 });
  y -= 12;

  const emitente = process.env.RECIBO_EMITENTE_NOME?.trim();
  if (emitente) {
    const doc = process.env.RECIBO_EMITENTE_DOC?.trim();
    linha(`Recebido por: ${emitente}${doc ? ` (${doc})` : ''}`);
  }
  linha(`Pago por: ${d.pagador.nome} (CPF ${cpfMascarado(d.pagador.cpf)})`);
  y -= 6;
  linha('Referente a:', { negrito: true });
  for (const item of d.itens) linha(`- ${item}`);
  y -= 6;
  linha(`Valor recebido: ${formatarReais(d.valorPagoCentavos)}`, { negrito: true, tamanho: 14 });
  if (d.creditoUsadoCentavos > 0) linha(`Abatido com crédito da carteira: ${formatarReais(d.creditoUsadoCentavos)}`);
  linha(`Forma de pagamento: ${d.meio}${d.pagoEm ? `, em ${descreverMomento(d.pagoEm)}` : ''}`);
  y -= 20;
  linha('Este recibo comprova o pagamento acima e não é nota fiscal.', { cor: cinza, tamanho: 9 });

  return pdf.save();
}
