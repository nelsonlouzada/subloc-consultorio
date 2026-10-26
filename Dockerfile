# Imagem única para os dois serviços do Railway (web e worker).
# O worker sobrescreve o comando de início em Settings: npm run worker
FROM node:22-slim

# Roda como o usuário `node`, sem privilégios: se alguém explorar o app, não tem root no contêiner.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

# Valores só para o `next build` conseguir carregar os módulos; nada disso vai para produção.
# Em produção valem as variáveis do serviço, lidas na hora de rodar.
# Exceção: NEXT_PUBLIC_* é embutida no build, por isso entra como ARG.
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=segredo-so-para-o-build-segredo-so-para-o-build \
    BETTER_AUTH_URL=http://localhost:3000 \
    npm run build

ENV NODE_ENV=production
EXPOSE 3000
# No Railway, o web usa o caminho de saúde /api/saude (Settings > Healthcheck Path); o worker não tem porta HTTP.
CMD ["npm", "start"]
