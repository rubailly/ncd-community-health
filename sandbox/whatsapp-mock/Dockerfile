FROM node:20.19-alpine
WORKDIR /app
COPY server.js package.json ./
USER node
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://localhost:9000/health || exit 1
CMD ["node", "server.js"]
