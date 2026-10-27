import type { MetadataRoute } from 'next';
import { siteIndexavel, urlDoSite } from '@/modulos/configuracao/pagina-publica';

export const dynamic = 'force-dynamic';

/** Só a página pública entra; vazio quando o site ainda não é indexável ou não há endereço configurado. */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = urlDoSite();
  if (!url || !siteIndexavel()) return [];
  return [{ url: `${url}/`, changeFrequency: 'monthly', priority: 1 }];
}
