import type { MetadataRoute } from 'next';
import { siteIndexavel, urlDoSite } from '@/modulos/configuracao/pagina-publica';

// Lido a cada pedido: o valor de SITE_INDEXAVEL vem do serviço, não da hora do build.
export const dynamic = 'force-dynamic';

/**
 * Só a página pública pode ser indexada, e só quando `SITE_INDEXAVEL=true`. O painel e as áreas
 * com login ficam sempre fora, mesmo depois da abertura.
 */
export default function robots(): MetadataRoute.Robots {
  const url = urlDoSite();
  if (!siteIndexavel()) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/$', disallow: ['/api/', '/login', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/inicio', '/agenda', '/solicitacoes', '/profissionais', '/reservas', '/series', '/series-da-sala', '/financeiro', '/configuracoes', '/reservar', '/minhas-reservas', '/carteira'] },
    ...(url ? { sitemap: `${url}/sitemap.xml` } : {}),
  };
}
