var child_process = require('child_process');
var exec = child_process.exec;
var fs = require('fs');
var tmp = require('tmp');

// Collection of functions for easy access to network manipulation tools on
// a Reaspberry PI.
class commands {

  // Simple function for using the command line for taking down an interface.
  static takeDown(iface, callback) {
    exec('iw dev '+iface+' del', callback);
  }
  
  static bringUp(iface, callback){
    exec('ifconfig ' + iface + ' up', callback)
  }

  static configureApIp(ip,callback){
    exec('ifconfig uap0 ' + ip, callback)
  }

  static addApInterface(callback) {
    exec('iw phy phy0 interface add uap0 type __ap', callback)
  }

  static startWpaSupplicant(callback) {
    console.log('should be starting the wpa thing')
    exec('wpa_supplicant -B -Dnl80211 -iwlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf', callback)
  }

  static listNetworks(callback){
    exec('wpa_cli -i wlan0 list_networks', callback)
  }

  static stopAP(callback) {
    exec('pkill hostapd dnsmasq', callback)
  }

  // Simplified function for making use of ifconfig command line tool.
  //ifconfig -v wlan0 inet 172.24.1.1
  //ifconfig -v wlan0 broadcast 172.24.1.255
  static ifconfig(iface, addressType, address, callback) {
    exec('ifconfig ' + iface + " "+ addressType + " " + address, callback);
  }

  // Simplified interface to iptables.
  static iptables(iface, flagString, callback) {
    var command = 'iptables -o ' + iface + " " + flagString;
    exec(command, callback);
  }

  // Function for making hostapd available to nodejs.  Has basic options
  // for the AP, but also allows for pass-in configuration parameters.
  static hostapd(options, callback) {
    var commands = [];

    // Known good options for the Raspberry PI 3.  If you are using the 
    // Raspberry PI Zero the driver value might need to be different.
    var defaultOptions = {
      driver:'nl80211',
      channel:6,
      hw_mode:'g',
      interface:'uap0',
      ssid:'fabmo'
    }

    var finalOptions = Object.assign(defaultOptions, options);
    if (options.password) {
      finalOptions.wpa_passphrase = finalOptions.password;
      delete finalOptions.password;
    }
   
    Object.getOwnPropertyNames(finalOptions).forEach(function(key) {
      commands.push(key + '=' + finalOptions[key]);
    });

    // The tmp package does nice things for you, like creating a tmp file in the proper
    // location and making sure its deleted after the fact.  Hostapd really wants to
    // take its configurations as a file.  So we shove all the options into one and 
    // pass it along.
    tmp.file((err, path, fd) => {
      if (err) throw err;

      // In case you want to look at the config file:
      console.log('File: ', path);

      // We then write in the configurations...
      console.log(fd);
      console.log(commands)
      fs.write(fd, commands.join('\n'), function(err, result) {
          if(err){
              console.log(err);
          } else {
              console.log(result)
          }
      });

      console.log("Commands being executed: ", commands);

      // Then execute the hostapd with the file and boom - AP should be started.
      exec('hostapd ' + path);

      // Now that we are done - go ahead and let others know.
      if (callback) {
        callback();
      }
    });
  }


  // Simplified access to dnsmasq - the fellow responsible for handing out IP
  // addresses to your wifi clients.  This can take commands as parameters
  // but this function again takes advantage of the file configuration method.
  static dnsmasq(options, callback) {
    var commands = [];
    var defaultOptions = {
      'interface':'uap0',
      'listen-address':'192.168.42.1',
      'bind-interfaces':'',
      'server': '8.8.8.8', // <--- Google's DNS servers.  Very handy.
      'domain-needed':'',
      'bogus-priv':'',
      'dhcp-range':'192.168.42.10,192.168.42.120,24h'
    }

    const finalOptions = Object.assign(options, defaultOptions);

    Object.getOwnPropertyNames(finalOptions).forEach(function(key) {
      if (options[key] != '') {
        commands.push(key + '=' + options[key]);
      } else {
        commands.push(key);
      }
    });

    exec('systemctl stop dnsmasq', () => {
      tmp.file((err, path, fd) => {
        if (err) console.log(err)
        console.log('writing dnsmasq file')
        fs.write(fd, commands.join('\n'), function(err, result){
            if(err){
                console.log(err);
            } else {
                console.log(result);
            }
        });

        console.log("Commands being executed: ", commands);
        exec('dnsmasq -C ' + path);
        if (callback) {
          callback();
        }
      });
    });
  }

  static dnsmasqETH(options, callback) {
    var commands = [];
    var defaultOptions = {
      'interface':'eth0',
      'listen-address':'192.168.44.1',
      'bind-interfaces':'',
      'server': '8.8.8.8', // <--- Google's DNS servers.  Very handy.
      'domain-needed':'',
      'bogus-priv':'',
      'dhcp-range':'192.168.42.10,192.168.42.120,24h'
    }

    const finalOptions = Object.assign(options, defaultOptions);

    Object.getOwnPropertyNames(finalOptions).forEach(function(key) {
      if (options[key] != '') {
        commands.push(key + '=' + options[key]);
      } else {
        commands.push(key);
      }
    });

    exec('systemctl stop dnsmasq', () => {
      tmp.file((err, path, fd) => {
        if (err) console.log(err)
        console.log('writing dnsmasq file')
        fs.write(fd, commands.join('\n'), function(err, result){
            if(err){
                console.log(err);
            } else {
                console.log(result);
            }
        });

        console.log("Commands being executed: ", commands);
        exec('dnsmasq -C ' + path);
        if (callback) {
          callback();
        }
      });
    });
  }


}

module.exports = commands;