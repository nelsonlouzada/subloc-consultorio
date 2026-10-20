import * as Sentry from '@sentry/node';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { enviarEmail } from '@/lib/email';

export type Notificacao = {
  usuarioId: string;
  para: string;
  /** Identifica o tipo de aviso, ex.: 'cadastro_aprovado'. */
  tipo: string;
  assunto: string;
  html: string;
  /** A que o aviso se refere, ex.: 'profissional' e o id dele. Junto com tipo e destinatário, evita envio em dobro. */
  referenciaTipo: string;
  referenciaId: string;
};

export type ResultadoNotificacao = 'enviado' | 'duplicado' | 'falhou';

/**
 * Envia um e-mail e registra o resultado em `notificacao`, sempre. Um aviso que já saiu com
 * sucesso não sai de novo; um que falhou pode ser tentado outra vez. Falha de e-mail nunca
 * derruba quem chamou: o fluxo de negócio (aprovar, reservar) segue, e o erro fica no registro
 * e no Sentry.
 */
export async function notificar(n: Notificacao): Promise<ResultadoNotificacao> {
  const chave = and(
    eq(schema.notificacao.tipo, n.tipo),
    eq(schema.notificacao.referenciaId, n.referenciaId),
    eq(schema.notificacao.usuarioId, n.usuarioId),
  );
  const [anterior] = await db.select({ status: schema.notificacao.status }).from(schema.notificacao).where(chave);
  if (anterior?.status === 'enviado') return 'duplicado';

  let erro: string | null = null;
  try {
    await enviarEmail(n.para, n.assunto, n.html);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, { tags: { notificacao: n.tipo } });
  }

  const registro = {
    usuarioId: n.usuarioId,
    tipo: n.tipo,
    assunto: n.assunto,
    status: erro ? ('falhou' as const) : ('enviado' as const),
    erro,
    referenciaTipo: n.referenciaTipo,
    referenciaId: n.referenciaId,
    enviadoEm: new Date(),
  };
  await db
    .insert(schema.notificacao)
    .values(registro)
    .onConflictDoUpdate({
      target: [schema.notificacao.tipo, schema.notificacao.referenciaId, schema.notificacao.usuarioId],
      set: { status: registro.status, erro: registro.erro, assunto: registro.assunto, enviadoEm: registro.enviadoEm },
    });
  return erro ? 'falhou' : 'enviado';
}

/** Os dois Anfitriões (D7): quem recebe os avisos de cadastro e de reserva. */
export async function anfitrioesAtivos() {
  return db
    .select({ id: schema.usuario.id, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.usuario)
    .where(and(eq(schema.usuario.papel, 'anfitriao'), eq(schema.usuario.ativo, true)));
}
