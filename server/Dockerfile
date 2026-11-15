FROM node:24-bookworm-slim
LABEL org.opencontainers.image.title="ShiroTerm Server" \
      org.opencontainers.image.description="Self-hosted encrypted profile synchronization for ShiroTerm" \
      org.opencontainers.image.source="https://github.com/Richailo/ShiroTerm" \
      org.opencontainers.image.licenses="MIT"
ARG BITWARDEN_CLI_VERSION=2026.10.1
RUN npm install --global --omit=dev @bitwarden/cli@${BITWARDEN_CLI_VERSION} \
    && npm cache clean --force \
    && mkdir -p /data /app && chown node:node /data /app
WORKDIR /app
COPY --chown=node:node package.json app.cjs main.cjs admin.cjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node LICENSE ./LICENSE
USER node:node
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "main.cjs"]
