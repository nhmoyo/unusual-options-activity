FROM apify/actor-node-playwright-chrome:22 AS builder

COPY package*.json ./

RUN npm install --audit=false && echo "All dependencies installed"

COPY . ./

FROM apify/actor-node-playwright-chrome:22

COPY --from=builder /usr/local/lib/node_modules ./node_modules

COPY . ./

CMD npm start --silent
