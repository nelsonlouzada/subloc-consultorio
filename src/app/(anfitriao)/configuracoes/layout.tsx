import Abas from './Abas';

export default function LayoutConfiguracoes({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
      <Abas />
      {children}
    </div>
  );
}
