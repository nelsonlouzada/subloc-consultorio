import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { fabrica } from '@/test/fabrica';
import { linkDaEntidade, listarEventos, NOME_ACAO, nomeDaAcao, opcoesDeFiltro, POR_PAGINA, resumirDados } from './lista';

const f = fabrica();
const entidade = `teste-lista-${randomUUID().slice(0, 8)}`;
afterAll(async () => {
  await db.delete(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidade, entidade));
  await f.limpar();
  await pool.end();
});

describe('textos da auditoria', () => {
  it('traduz as ações conhecidas e deixa legível a que não conhece', () => {
    expect(nomeDaAcao('regras_alteradas')).toBe('Regras alteradas');
    expect(nomeDaAcao('acesso_desativado')).toBe('Acesso desativado');
    expect(nomeDaAcao('algo_muito_novo')).toBe('Algo muito novo');
  });

  it('leva à tela da entidade só quando ela existe, com o id codificado', () => {
    expect(linkDaEntidade('reserva', 'abc')).toBe('/reservas/abc');
    expect(linkDaEntidade('profissional', 'a/b c')).toBe('/profissionais/a%2Fb%20c');
    expect(linkDaEntidade('serie', 'x')).toBe('/series-da-sala/x');
    expect(linkDaEntidade('espaco', 'qualquer')).toBe('/configuracoes');
    expect(linkDaEntidade('documento_legal', null)).toBe('/configuracoes/documentos');
    expect(linkDaEntidade('financeiro', null)).toBe('/financeiro');
    expect(linkDaEntidade('reserva', null)).toBeNull();
    expect(linkDaEntidade('cobranca', 'x')).toBeNull();
    expect(linkDaEntidade('javascript:alert(1)', 'x')).toBeNull();
  });

  it('resume os dados em uma linha, esconde o que parece segredo e corta o excesso', () => {
    expect(resumirDados(null)).toBe('');
    expect(resumirDados({})).toBe('');
    expect(resumirDados({ motivo: 'Teste', de: 'aprovado' })).toBe('{"motivo":"Teste","de":"aprovado"}');
    expect(resumirDados({ antes: { senha: 'abc123' }, codigoAcesso: '9876', lista: [{ token: 't' }], cpf: '52998224725', ok: 1 })).toBe(
      '{"antes":{"senha":"•••"},"codigoAcesso":"•••","lista":[{"token":"•••"}],"cpf":"•••","ok":1}',
    );
    const longo = resumirDados({ texto: 'x'.repeat(500) });
    expect(longo.length).toBe(140);
    expect(longo.endsWith('…')).toBe(true);
  });
});

describe('listar eventos', () => {
  it('pagina do mais novo para o mais antigo, com quem fez, e ajusta páginas fora do limite', async () => {
    const anf = await f.anfitriao();
    const base = Date.UTC(2033, 0, 1);
    await db.insert(schema.eventoAuditoria).values(
      Array.from({ length: POR_PAGINA + 20 }, (_, i) => ({ usuarioId: i % 2 === 0 ? anf : null, acao: i % 3 === 0 ? 'regras_alteradas' : 'sala_alterada', entidade, entidadeId: `e${i}`, criadoEm: new Date(base + i * 1000) })),
    );

    const p1 = await listarEventos({ entidade });
    expect(p1).toMatchObject({ total: 70, pagina: 1, paginas: 2 });
    expect(p1.linhas).toHaveLength(POR_PAGINA);
    expect(p1.linhas[0].entidadeId).toBe('e69'); // o mais novo primeiro
    expect(p1.linhas[0].quem).toBeNull(); // i = 69 é ímpar: ação do sistema
    expect(p1.linhas[1].quem).toBe('Anfitrião 1');

    const p2 = await listarEventos({ entidade, pagina: 2 });
    expect(p2.linhas).toHaveLength(20);
    expect(p2.linhas[19].entidadeId).toBe('e0');

    expect((await listarEventos({ entidade, pagina: 99 })).pagina).toBe(2);
    expect((await listarEventos({ entidade, pagina: 0 })).pagina).toBe(1);
    expect((await listarEventos({ entidade, pagina: -3 })).pagina).toBe(1);
    expect((await listarEventos({ entidade, pagina: Number.NaN })).pagina).toBe(1);
  });

  it('filtra por ação e por entidade, e diz as opções que existem', async () => {
    const regras = await listarEventos({ entidade, acao: 'regras_alteradas' });
    expect(regras.total).toBe(24); // i múltiplo de 3 entre 0 e 69
    expect(regras.linhas.every((l) => l.acao === 'regras_alteradas')).toBe(true);
    expect((await listarEventos({ entidade, acao: 'inexistente' })).total).toBe(0);
    expect((await listarEventos({ entidade: 'nao-existe-mesmo' })).linhas).toEqual([]);

    const o = await opcoesDeFiltro();
    expect(o.acoes).toEqual(expect.arrayContaining(['regras_alteradas', 'sala_alterada']));
    expect(o.entidades).toContain(entidade);
  });
});

describe('nomes das ações', () => {
  it('toda ação gravada no código tem nome em português na tela de auditoria', () => {
    const fora = new Set(['processado', 'problema', 'ignorado']); // estados do webhook, não são ações de auditoria
    const ativas: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) {
          for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
            const m = /\bacao: ([^,}\n]+)/.exec(linha);
            if (m) for (const s of m[1].matchAll(/'([a-z]+(?:_[a-z]+)+)'/g)) ativas.push(s[1]);
          }
        }
      }
    };
    varrer(join(__dirname, '..', '..'));
    const sem = [...new Set(ativas)].filter((a) => !fora.has(a) && !(a in NOME_ACAO));
    expect(sem).toEqual([]);
    // as que o código monta por composição
    for (const a of ['profissional_aprovado', 'profissional_recusado', 'profissional_bloqueado', 'reserva_expirada_aprovacao', 'reserva_expirada_pagamento']) expect(NOME_ACAO).toHaveProperty(a);
  });
});
