FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY cgv_api.js ./
COPY cloud_monitor.js ./

EXPOSE 3000

CMD ["node", "cloud_monitor.js"]
