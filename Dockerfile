FROM node@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS node-build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM python@sha256:82bc3c539b8813ada9d68c63b40158fa002f7f33de9bf3312a3dfdc0620dff56
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates=20250419~deb12u2 curl=7.88.1-10+deb12u15 libglib2.0-0=2.74.6-2+deb12u9 libgomp1=12.2.0-14+deb12u1 libstdc++6=12.2.0-14+deb12u1 && rm -rf /var/lib/apt/lists/*
COPY --from=node-build /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
ENV NODE_ENV=production CATALOG_PYTHON=/opt/catalog-venv/bin/python PYTHONDONTWRITEBYTECODE=1
COPY vendor/requirements.lock /opt/catalog/requirements.lock
RUN python -m venv /opt/catalog-venv && /opt/catalog-venv/bin/pip install --only-binary=:all: --require-hashes -r /opt/catalog/requirements.lock
COPY vendor/se_catalog_core-2026.10.25.1-py3-none-any.whl /opt/catalog/
RUN /opt/catalog-venv/bin/pip install --no-deps /opt/catalog/se_catalog_core-2026.10.25.1-py3-none-any.whl
COPY --from=node-build /app/node_modules /app/node_modules
COPY package*.json ./
COPY src ./src
COPY LICENSE /app/LICENSE
COPY core/LICENSE core/NOTICE.md core/BOT-MIT-LICENSE core/OPENCC-LICENSE core/OPENCC-THIRD-PARTY-LICENSES.md core/THIRD-PARTY-NOTICES.md /opt/catalog/licenses/
CMD ["node", "src/bot.js"]
