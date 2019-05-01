FROM node:10.15.3-stretch AS node

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install


FROM raspbian/stretch


RUN apt-get update --fix-missing && apt-get install -y curl hostapd dnsmasq iptables net-tools wireless-tools wpasupplicant iw 


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

RUN touch /lib/systemd/system/fabmo.service
RUN echo "[Unit] \n" \
"Description=FabMo Engine \n" \
"\n"\
"[Service] \n" \
"Environment=PLATFORM=raspberry-pi \n" \
"Type=simple \n" \
"ExecStart=/usr/bin/node /usr/src/app/server.js \n" \
"Restart=on-failure \n" \
"WorkingDirectory = /usr/src/app/ \n" \
"\n"\
"[Install] \n" \
"WantedBy=multi-user.target \n" > /lib/systemd/system/fabmo.service


ENV container docker
ENV LC_ALL C
ARG DEBIAN_FRONTEND=noninteractive
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

RUN systemctl enable fabmo 

ENV init /lib/systemd/systemd


VOLUME [ "/sys/fs/cgroup" ]

EXPOSE 80
CMD ["/lib/systemd/systemd"]

