FROM node:10.15.3-stretch AS node

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install




FROM raspbian/stretch

ARG DEBIAN_FRONTEND=noninteractive

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

RUN mkdir -p /etc/wpa_supplicant/
COPY ./dockerconfigs/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf

EXPOSE 80
# CMD ["/lib/systemd/systemd"]
CMD ["npm", "start"]
