FROM navikey/raspbian-bullseye

RUN apt-get -qq update && \
    DEBIAN_FRONTEND=noninteractive apt-get -qq install -y \
    curl \ 
    hostapd \ 
    dnsmasq \
    wireless-tools \ 
    wpasupplicant \ 
    iw \
    net-tools \ 
    isc-dhcp-server \
    build-essential \
    zip \
    libreadline-dev


RUN curl -fsSL https://deb.nodesource.com/setup_16.x | bash - && apt-get install -y nodejs

VOLUME ["/opt/fabmo", "/fabmo"]

COPY ./dockerconfigs/wpa_supplicant.conf /etc/wpa_supplicant/wpa_supplicant.conf

EXPOSE 80

RUN useradd --create-home --shell  /bin/bash  -G sudo -p "$(openssl passwd -1 shopbot)" pi 

WORKDIR /fabmo

USER root
