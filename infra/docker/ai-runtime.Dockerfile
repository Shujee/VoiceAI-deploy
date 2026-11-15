FROM node:24

RUN npm install -g pnpm@11.20.0

ENV NODE_ENV=development

WORKDIR /app

# Previously CMD was `tail -f /dev/null`, a placeholder, with the real dev
# server (`pnpm run dev`) started by hand via `docker compose exec` in an
# SSH session each time. That meant Docker never knew the dev process
# existed: `docker compose restart` couldn't touch it, and a dropped SSH
# connection or a Ctrl+C that didn't land cleanly left it running forever,
# invisible, still bound to port 3001 and quietly answering calls while a
# freshly-exec'd instance sat stuck unable to bind that port - a duplicate-
# process ghost that recurred repeatedly (2026-09-10/11 GCP VM testing).
# Making `pnpm run dev` the container's actual PID 1 means Docker owns its
# whole lifecycle: `docker compose restart ai-runtime` reliably replaces
# it (old process killed via normal SIGTERM, never orphaned), and
# `docker compose logs -f ai-runtime` gives live logs with no manual exec
# or tee needed at all.
CMD ["pnpm", "run", "dev"]