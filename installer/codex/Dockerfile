FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
WORKDIR /opt/devagent
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY runner.mjs /opt/devagent/runner.mjs
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/devagent/runner.mjs"]
