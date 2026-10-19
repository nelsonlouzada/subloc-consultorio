import { redirect } from 'next/navigation';
import { sessaoAtual } from '@/lib/sessao';

// A página pública da sala (T01) chega na E6. Até lá, a raiz só encaminha.
export default async function Raiz() {
  const sessao = await sessaoAtual();
  redirect(sessao?.user.papel === 'anfitriao' ? '/inicio' : '/login');
}
