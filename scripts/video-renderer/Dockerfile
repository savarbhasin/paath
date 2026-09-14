FROM node:22-bookworm-slim
# Match Hyperframes' supported ARM64 headless-shell strategy; do not use
# Debian's ARM Chromium, which upstream reports can crash on startup.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    PUPPETEER_SKIP_DOWNLOAD=true \
    DO_NOT_TRACK=1 \
    CONTAINER=true
WORKDIR /opt/renderer
RUN npm init -y && npm install --save-exact hyperframes@0.8.34 gsap@3.13.0 playwright-core@1.61.1 \
    && npx playwright-core install --with-deps chromium-headless-shell \
    && apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /opt/browsers
COPY run.mjs /opt/renderer/run.mjs
WORKDIR /project
ENTRYPOINT ["node", "/opt/renderer/run.mjs"]
