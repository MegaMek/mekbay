# https://hub.docker.com/_/node
FROM node:24-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci

RUN npm install -g @angular/cli

COPY . .

RUN ng build --configuration production


FROM nginx:alpine AS runtime

COPY --from=build /usr/src/app/dist/* /usr/share/nginx/html/

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
