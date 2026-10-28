# Production image for an Alibaba Cloud Simple Application Server (Ubuntu 24.04) via Docker.
# Official Node via AWS Public ECR (avoids Docker Hub anonymous pull limits).
# The image is Alpine; the VM itself stays Ubuntu. Do not copy host node_modules in.
FROM public.ecr.aws/docker/library/node:20-alpine AS base

# libc6-compat + build tools for native modules; tzdata so TZ is honored by the OS.
# NODE_ENV stays unset until after pnpm install, or devDependencies are skipped.
RUN apk add --no-cache libc6-compat python3 make g++ tzdata

RUN npm install -g pnpm@10

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json ./

COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
COPY artifacts/invoiceplane ./artifacts/invoiceplane
COPY scripts ./scripts
# Re-copy migrations after app sources so a stale cached `COPY lib` layer
# cannot keep the old 0039 ADD CONSTRAINT while api-server JS is rebuilt.
COPY lib/db/migrations ./lib/db/migrations

RUN pnpm install --frozen-lockfile && pnpm rebuild

RUN pnpm --filter @workspace/invoiceplane run build
RUN pnpm --filter @workspace/api-server run build

WORKDIR /app/artifacts/api-server

# Bind-mount a host directory here (`/var/lib/gc-inv/uploads:/data`) so logos,
# chops, and other uploads survive container recreate. The mount hides these
# directories; the app creates them on first upload.
RUN mkdir -p /data/public-objects /data/private-objects

ENV NODE_ENV=production
ENV TZ=Asia/Hong_Kong

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
