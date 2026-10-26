'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { CONSELHO_PADRAO, CONSELHOS, PROFISSOES, UFS } from '@/modulos/identidade/opcoes';
import { cadastrarAction, type EstadoCadastro } from './actions';

const PASSOS = ['Seus dados', 'Profissão e registro', 'Senha e contrato'] as const;
const CAMPOS_DO_PASSO: string[][] = [
  ['nome', 'email', 'telefone', 'cpf'],
  ['profissao', 'conselho', 'registroNumero', 'registroUf'],
  ['senha', 'confirmarSenha', 'aceiteContrato'],
];

const entrada = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';
const rotulo = 'mb-1 block text-sm font-medium';

function Campo({ id, texto, erro, children }: { id: string; texto: string; erro?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={rotulo}>
        {texto}
      </label>
      {children}
      {erro && (
        <p id={`${id}-erro`} role="alert" className="mt-1 text-sm text-red-700">
          {erro}
        </p>
      )}
    </div>
  );
}

type Profissao = keyof typeof PROFISSOES;
type Conselho = keyof typeof CONSELHOS;

export default function FormularioCadastro({ contrato, versao }: { contrato: string; versao: number }) {
  const [estado, acao, enviando] = useActionState<EstadoCadastro, FormData>(cadastrarAction, {});
  const [passo, setPasso] = useState(0);
  const [profissao, setProfissao] = useState<Profissao>('psicologo');
  const [conselho, setConselho] = useState<Conselho>('CRP');
  const passosRef = useRef<(HTMLFieldSetElement | null)[]>([]);

  const valores = estado.valores ?? {};
  const erros = estado.campos ?? {};
  const invalido = (campo: string) => (erros[campo] ? true : undefined);
  const descrito = (campo: string) => (erros[campo] ? `${campo}-erro` : undefined);

  // Depois de uma resposta com erro, volta ao primeiro passo que tem campo com problema e
  // restaura a profissão e o conselho que a pessoa tinha escolhido.
  useEffect(() => {
    const comErro = CAMPOS_DO_PASSO.findIndex((lista) => lista.some((c) => erros[c]));
    if (comErro >= 0) setPasso(comErro);
    if (valores.profissao) setProfissao(valores.profissao as Profissao);
    if (valores.conselho) setConselho(valores.conselho as Conselho);
  }, [estado]); // eslint-disable-line react-hooks/exhaustive-deps

  function avancar() {
    const campos = passosRef.current[passo]?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select');
    for (const c of campos ?? []) if (!c.reportValidity()) return;
    setPasso((p) => p + 1);
  }

  if (estado.ok) {
    return (
      <div role="status" className="space-y-3">
        <h2 className="text-lg font-semibold">Cadastro enviado</h2>
        <p className="text-sm text-zinc-700">
          Enviamos um e-mail para confirmar o seu endereço. Clique no link da mensagem e depois entre no sistema.
        </p>
        <p className="text-sm text-zinc-700">
          Seu cadastro será analisado pelos responsáveis pela sala. Você já poderá ver a agenda e pedir uma reserva
          enquanto isso.
        </p>
        <Link href="/login" className="inline-block btn btn-primary">
          Ir para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={acao} className="space-y-5">
      <ol className="flex gap-2 text-xs" aria-label="Passos do cadastro">
        {PASSOS.map((nome, i) => (
          <li
            key={nome}
            aria-current={i === passo ? 'step' : undefined}
            className={`flex-1 rounded-full px-2 py-1 text-center ${i === passo ? 'bg-accent text-white' : 'bg-zinc-200 text-zinc-700'}`}
          >
            {i + 1}. {nome}
          </li>
        ))}
      </ol>

      <fieldset hidden={passo !== 0} ref={(el) => { passosRef.current[0] = el; }} className="space-y-4">
        <legend className="sr-only">{PASSOS[0]}</legend>
        <Campo id="nome" texto="Nome completo" erro={erros.nome}>
          <input id="nome" name="nome" defaultValue={valores.nome} required autoComplete="name" aria-invalid={invalido('nome')} aria-describedby={descrito('nome')} className={entrada} />
        </Campo>
        <Campo id="email" texto="E-mail" erro={erros.email}>
          <input id="email" name="email" type="email" defaultValue={valores.email} required autoComplete="email" aria-invalid={invalido('email')} aria-describedby={descrito('email')} className={entrada} />
        </Campo>
        <Campo id="telefone" texto="Telefone com DDD" erro={erros.telefone}>
          <input id="telefone" name="telefone" type="tel" defaultValue={valores.telefone} required autoComplete="tel" inputMode="tel" aria-invalid={invalido('telefone')} aria-describedby={descrito('telefone')} className={entrada} />
        </Campo>
        <Campo id="cpf" texto="CPF" erro={erros.cpf}>
          <input id="cpf" name="cpf" defaultValue={valores.cpf} required inputMode="numeric" autoComplete="off" aria-invalid={invalido('cpf')} aria-describedby={descrito('cpf')} className={entrada} />
        </Campo>
      </fieldset>

      <fieldset hidden={passo !== 1} ref={(el) => { passosRef.current[1] = el; }} className="space-y-4">
        <legend className="sr-only">{PASSOS[1]}</legend>
        <Campo id="profissao" texto="Profissão" erro={erros.profissao}>
          <select
            id="profissao"
            name="profissao"
            value={profissao}
            onChange={(e) => {
              const p = e.target.value as Profissao;
              setProfissao(p);
              setConselho(CONSELHO_PADRAO[p]);
            }}
            className={entrada}
          >
            {Object.entries(PROFISSOES).map(([chave, nome]) => (
              <option key={chave} value={chave}>
                {nome}
              </option>
            ))}
          </select>
        </Campo>
        <Campo id="conselho" texto="Conselho profissional" erro={erros.conselho}>
          <select id="conselho" name="conselho" value={conselho} onChange={(e) => setConselho(e.target.value as Conselho)} className={entrada}>
            {Object.entries(CONSELHOS).map(([chave, nome]) => (
              <option key={chave} value={chave}>
                {nome}
              </option>
            ))}
          </select>
        </Campo>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Campo id="registroNumero" texto="Número do registro" erro={erros.registroNumero}>
              <input id="registroNumero" name="registroNumero" defaultValue={valores.registroNumero} required autoComplete="off" aria-invalid={invalido('registroNumero')} aria-describedby={descrito('registroNumero')} className={entrada} />
            </Campo>
          </div>
          <Campo id="registroUf" texto="UF" erro={erros.registroUf}>
            <select id="registroUf" name="registroUf" defaultValue={valores.registroUf ?? ''} required className={entrada}>
              <option value="" disabled>
                —
              </option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <p className="text-xs text-zinc-600">
          Os responsáveis pela sala conferem o registro no site do conselho antes de aprovar. Você não precisa enviar documentos.
        </p>
      </fieldset>

      <fieldset hidden={passo !== 2} ref={(el) => { passosRef.current[2] = el; }} className="space-y-4">
        <legend className="sr-only">{PASSOS[2]}</legend>
        <Campo id="senha" texto="Senha (mínimo de 10 caracteres)" erro={erros.senha}>
          <input id="senha" name="senha" type="password" required minLength={10} autoComplete="new-password" aria-invalid={invalido('senha')} aria-describedby={descrito('senha')} className={entrada} />
        </Campo>
        <Campo id="confirmarSenha" texto="Repita a senha" erro={erros.confirmarSenha}>
          <input id="confirmarSenha" name="confirmarSenha" type="password" required minLength={10} autoComplete="new-password" aria-invalid={invalido('confirmarSenha')} aria-describedby={descrito('confirmarSenha')} className={entrada} />
        </Campo>
        <div>
          <p className={rotulo} id="contrato-titulo">
            Contrato (versão {versao})
          </p>
          <div
            role="region"
            aria-labelledby="contrato-titulo"
            tabIndex={0}
            className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-sm"
          >
            {contrato}
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="aceiteContrato" required aria-label="Li e aceito o contrato" aria-invalid={invalido('aceiteContrato')} aria-describedby={descrito('aceiteContrato')} className="mt-1" />
            <span>Li e aceito o contrato.</span>
          </label>
          {erros.aceiteContrato && (
            <p id="aceiteContrato-erro" role="alert" className="mt-1 text-sm text-red-700">
              {erros.aceiteContrato}
            </p>
          )}
        </div>
      </fieldset>

      {estado.erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {estado.erro}
        </p>
      )}

      <div className="flex items-center gap-3">
        {passo > 0 && (
          <button type="button" onClick={() => setPasso((p) => p - 1)} className="rounded-lg border border-zinc-300 px-4 py-2.5">
            Voltar
          </button>
        )}
        {passo < PASSOS.length - 1 ? (
          <button type="button" onClick={avancar} className="ml-auto btn btn-primary">
            Próximo
          </button>
        ) : (
          <button type="submit" disabled={enviando} className="ml-auto btn btn-primary disabled:opacity-60">
            {enviando ? 'Enviando…' : 'Concluir cadastro'}
          </button>
        )}
      </div>
    </form>
  );
}
