/**
 * Assunto de e-mail seguro. O assunto é texto puro (não HTML), mas pode carregar nomes digitados por
 * usuários: aqui saem as marcações (`<script>`, `<img ...>`), as quebras de linha e os caracteres de controle
 * (que num cabeçalho de e-mail poderiam ser usados para injetar outros cabeçalhos), e o tamanho é limitado.
 */
export function assuntoSeguro(texto: string, tamanhoMaximo = 150): string {
  const limpo = texto
    .replace(/<[^>]*>/g, ' ') // marcação completa
    .replace(/[<>]/g, '') // sobras de marcação mal formada
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ') // controles (inclui quebras de linha) e separadores de linha/parágrafo
    .replace(/\s+/g, ' ')
    .trim();
  return limpo.length > tamanhoMaximo ? `${limpo.slice(0, tamanhoMaximo - 1).trimEnd()}…` : limpo;
}
