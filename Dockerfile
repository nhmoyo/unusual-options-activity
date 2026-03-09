FROM apify/actor-node-playwright-chrome:22

COPY package*.json ./
RUN npm install --audit=false

COPY . ./

CMD npm start --silent
