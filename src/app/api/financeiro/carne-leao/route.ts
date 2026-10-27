import { NextResponse } from 'next/server';
import { contextoRequisicao, sessaoAtual } from '@/lib/sessao';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { gerarCsvCarneLeao, lancamentosDoMes, lerMes, mesAtual } from '@/modulos/financeiro/relatorio';

/**
 * CSV do mês para o carnê-leão (T25). Traz nome e CPF de quem pagou, então só Anfitrião acessa e
 * cada exportação fica na auditoria. Sem `mes`, vale o mês atual; mês inválido é erro, nunca um palpite.
 */
export async function GET(req: Request) {
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });
  if (sessao.user.papel !== 'anfitriao') return NextResponse.json({ erro: 'sem permissão' }, { status: 403 });

  const pedido = new URL(req.url).searchParams.get('mes');
  const mes = pedido === null ? mesAtual() : lerMes(pedido);
  if (!mes) return NextResponse.json({ erro: 'mês inválido (use AAAA-MM)' }, { status: 400 });

  const lancamentos = await lancamentosDoMes(mes);
  const { ip } = await contextoRequisicao();
  await registrarAuditoria({ usuarioId: sessao.user.id, acao: 'relatorio_exportado', entidade: 'financeiro', dados: { relatorio: 'carne_leao', mes: mes.texto, linhas: lancamentos.length }, ip });

  return new NextResponse(gerarCsvCarneLeao(lancamentos), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="recebimentos-${mes.texto}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
