FROM node:10.15.3-stretch AS node

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install




FROM raspbian/stretch


RUN apt-get update --fix-missing && apt-get install -y curl hostapd dnsmasq  wireless-tools wpasupplicant iw net-tools isc-dhcp-server


WORKDIR /usr/src/app

COPY package*.json ./


 

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -
RUN apt-get install -y nodejs

RUN mkdir node_modules
COPY --from=node /usr/src/app/node_modules ./node_modules


####Set up BOSSA 

COPY ./BOSSA /workspace


## Install and Build Clean up in one step
## Minimize image size despite in-situ build
RUN apt-get update        && \
    apt-get install -y       \
    	build-essential      \
	    openocd              \
	    libwxgtk3.0-dev      \
	    libreadline-dev      \
	    usbutils             \
	                      && \
    make -C /workspace    && \
    cp /workspace/bin/*      \
       /usr/local/bin/    && \
    rm -rf workspace      && \
    apt-get purge -y         \
        build-essential      \
	    libreadline-dev      \
	    libwxgtk3.0-dev   && \
    apt-get autoremove -y && \
    rm -rf                   \
       /var/lib/apt/lists/*

# Bundle app source

COPY . .

RUN npm run prod

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

RUN mkdir -p /etc/wpa_supplicant/
COPY ./dockerconfigs/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf



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

