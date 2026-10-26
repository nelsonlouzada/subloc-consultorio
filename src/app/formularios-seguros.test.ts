import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EsqueciSenha from './esqueci-senha/page';

// QA-05: se o formulário de login for enviado antes de a página terminar de carregar, o navegador o envia "puro"
// (GET) e a senha ou o e-mail vão parar na URL. Duas defesas: `method="post"` e o botão desabilitado até carregar.

describe('formulários de acesso não vazam dados para a URL', () => {
  it('esqueci-senha, como o servidor entrega a página: POST e botão desabilitado', () => {
    const html = renderToStaticMarkup(createElement(EsqueciSenha));
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/);
  });

  // Login e redefinição só aparecem depois do JavaScript (usam parâmetros da URL), então não dá para renderizá-los
  // aqui sem o roteador do Next: a garantia é conferir o código.
  it.each(['login/page.tsx', 'redefinir-senha/page.tsx', 'esqueci-senha/page.tsx'])('%s: method="post" e botão preso até a hidratação', (arquivo) => {
    const fonte = readFileSync(path.join(__dirname, arquivo), 'utf-8');
    expect(fonte).toMatch(/<form[^>]*method="post"/);
    expect(fonte).toContain('usePronto()');
    expect(fonte).toMatch(/disabled=\{enviando \|\| !pronto\}/);
  });
});
