FROM node:24

RUN npm install -g pnpm@11.20.0

ENV NODE_ENV=development

WORKDIR /app

# Previously `tail -f /dev/null`, a placeholder, with the real dev server
# (`pnpm run dev`, i.e. vite --host 0.0.0.0) started by hand via
# `docker compose exec frontend pnpm run dev` in an SSH session. Same fix as
# ai-runtime.Dockerfile (see its own comment for the ghost-process history
# this caused there) - making `pnpm run dev` the container's actual PID 1
# means `docker compose up`/`restart` owns its whole lifecycle, and
# `docker compose logs -f frontend` gives live logs with no manual exec
# needed.
CMD ["pnpm", "run", "dev"]