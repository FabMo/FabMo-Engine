FROM node:10.15.1

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN apt-get update --fix-missing && apt-get install -y hostapd dnsmasq haveged

RUN npm install
# If you are building your code for production
# RUN npm install --only=production



# Bundle app source
COPY . .

EXPOSE 80
CMD [ "npm", "start" ]