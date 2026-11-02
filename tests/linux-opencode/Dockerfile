FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
RUN npm install --global @opencode/cli@2.2.5 pnpm@10.20.0
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node . .
USER node
RUN pnpm install --frozen-lockfile && pnpm build
CMD ["node", "tests/linux-opencode/run.mjs"]
