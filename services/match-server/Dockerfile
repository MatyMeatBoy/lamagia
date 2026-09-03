FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY services/match-server/package.json services/match-server/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace=@prossh/match-server
EXPOSE 8787
CMD ["node", "services/match-server/dist/index.js"]

