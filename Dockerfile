FROM node:10.15.3-stretch AS node

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install


FROM rasbian/stretch
ENV container docker
ENV LC_ALL C
ENV DEBIAN_FRONTEND noninteractive
RUN cd /lib/systemd/system/sysinit.target.wants/; ls | grep -v systemd-tmpfiles-setup | xargs rm -f $1 \
rm -f /lib/systemd/system/multi-user.target.wants/*;\
rm -f /etc/systemd/system/*.wants/*;\
rm -f /lib/systemd/system/local-fs.target.wants/*; \
rm -f /lib/systemd/system/sockets.target.wants/*udev*; \
rm -f /lib/systemd/system/sockets.target.wants/*initctl*; \
rm -f /lib/systemd/system/basic.target.wants/*;\
rm -f /lib/systemd/system/anaconda.target.wants/*; \
rm -f /lib/systemd/system/plymouth*; \
rm -f /lib/systemd/system/systemd-update-utmp*;
RUN systemctl set-default multi-user.target
ENV init /lib/systemd/systemd
VOLUME [ "/sys/fs/cgroup" ]
ENTRYPOINT ["/lib/systemd/systemd"]

# Create app directory

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)

RUN apt-get update --fix-missing && apt-get install -y systemd wireless-tools curl hostapd dnsmasq
WORKDIR /usr/src/app

COPY package*.json ./


 

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install -y nodejs

RUN node -v 
RUN npm -v 

RUN mkdir node_modules
COPY --from=node /usr/src/app/node_modules ./node_modules

# Bundle app source
COPY . .

EXPOSE 80
CMD [ "npm", "start" ]