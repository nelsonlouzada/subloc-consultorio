'use client';

import { useEffect, useState } from 'react';

/**
 * `false` até a página terminar de carregar no navegador (hidratação), `true` depois. Os formulários de login
 * usam isto para manter o botão de enviar desabilitado até lá: antes disso o JavaScript que cuida do envio ainda
 * não existe, e um clique enviaria o formulário "puro" do navegador, que levaria senha e e-mail para a URL.
 */
export function usePronto(): boolean {
  const [pronto, setPronto] = useState(false);
  useEffect(() => setPronto(true), []);
  return pronto;
}
