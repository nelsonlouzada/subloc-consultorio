import type { NextConfig } from "next";
import { cabecalhosDeSeguranca } from "./src/lib/cabecalhos";

const nextConfig: NextConfig = {
  // Não anuncia a tecnologia do servidor em cada resposta.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca({ producao: process.env.NODE_ENV === "production" }) }];
  },
};

export default nextConfig;
