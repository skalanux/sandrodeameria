FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173

COPY --chown=node:node package.json ./
COPY --chown=node:node server.js app.js index.html styles.css phrases.json ./
COPY --chown=node:node lib ./lib

USER node
EXPOSE 4173

CMD ["node", "server.js"]
