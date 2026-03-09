FROM apify/actor-node-playwright-chrome:22 AS builder

COPY --chown=myuser package*.json ./

RUN npm install --include=dev --audit=false && echo "All dependencies installed"

COPY --chown=myuser . ./

FROM apify/actor-node-playwright-chrome:22

COPY --from=builder --chown=myuser /usr/local/lib/node_modules ./node_modules

COPY --chown=myuser . ./

CMD npm start --silent
