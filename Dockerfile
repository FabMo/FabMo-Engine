FROM node:10 AS node

WORKDIR /

COPY package*.json ./

RUN npm install

FROM raspbian/stretch

COPY ./BOSSA /workspace

RUN DEBIAN_FRONTEND=noninteractive apt-get update --fix-missing \
&& apt-get install -y \
    curl \ 
    hostapd \ 
    dnsmasq \
    wireless-tools \ 
    wpasupplicant \ 
    iw \
    net-tools \ 
    isc-dhcp-server \
    build-essential \
    openocd \
    libwxgtk3.0-dev \
    libreadline-dev \
    usbutils \
&& make -C /workspace \
&& mkdir -p /etc/wpa_supplicant/ \
&& cp /workspace/bin/* \
    /usr/local/bin/ \
&& rm -rf workspace \  
&& apt-get purge -y \
    build-essential \
	libreadline-dev \
	libwxgtk3.0-dev \
    && apt-get autoremove -y \
&& rm -rf /var/lib/apt \
&& curl -sL https://deb.nodesource.com/setup_10.x | bash - \
&& apt-get install -y nodejs \
&& mkdir -p /etc/wpa_supplicant/


WORKDIR /usr/src/app


COPY --from=node ./node_modules ./node_modules

COPY . . 

COPY ./dockerconfigs/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf

EXPOSE 80
# CMD ["/lib/systemd/systemd"]
CMD ["npm", "start"]
