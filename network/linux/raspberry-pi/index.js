var log = require('../../../log').logger('network');
var os = require('os');
var config = require('../../../config')
var async = require('async');
var fs = require('fs');
var child_process = require('child_process');
var exec = child_process.exec;
var util = require('util');
var NetworkManager = require('../../../network_manager').NetworkManager;
var tmp = require('tmp');


var ifconfig = require('wireless-tools/ifconfig');
var iwconfig = require('wireless-tools/iwconfig');
var iwlist = require('wireless-tools/iwlist');
var wpa_cli = require('wireless-tools/wpa_cli');
var udhcpc = require('wireless-tools/udhcpc');
var udhcpd = require('wireless-tools/udhcpd');

const commands = require('./commands.js');
const hostInterface = 'wlan0';  // The WiFi Access Device.


const EventEmitter = require('events');
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

var wifi;
var WIFI_SCAN_INTERVAL = 5000;
var WIFI_SCAN_RETRIES = 3;
var WIFI_SCAN_COUNT = 0;

var wifiInterface = 'wlan0';
var apInterface = 'uap0';
var ethernetInterface = "eth0";
var apModeGateway= '192.168.42.1';
var tmpPath = os.tmpdir() + '/';

var last_name ="";


var DEFAULT_NETMASK = "255.255.255.0";
var DEFAULT_BROADCAST = "192.168.1.255"
// This is how long the system will wait for DHCP before going into "magic mode" (ms)
var DHCP_MAGIC_TTL = 5000;
var ETHERNET_SCAN_INTERVAL = 2000;
var NETWORK_HEALTH_RETRIES = 8;
var NETWORK_HEALTH_RETRY_INTERVAL = 10000;


var RaspberryPiNetworkManager = function() {
  this.mode = 'unknown';
  this.wifiState = 'idle';
  this.ethernetState = 'idle';
  this.networks = [];
  this.command = null;
  this.network_health_retries = NETWORK_HEALTH_RETRIES;
  this.network_history = {};
  this.networkInfo = {
    wireless: null,
    wired : null
  };
}
util.inherits(RaspberryPiNetworkManager, NetworkManager);

RaspberryPiNetworkManager.prototype.set_uuid = function(callback) {
  var uuid = ""
////##
log.debug('SETTING UUID')
  log.info('SETTING UUID');
  exec("cat /proc/cpuinfo | grep Serial | cut -d ' ' -f 2",function(err,result){
    if (err) {
      var name = {'name' : "fabmo"}
      config.engine.update(name, function() {
        callback(name);
      })
    } else {
      var name = {'name' : "fabmo-" + result }
      config.engine.update(name, function() {
        callback(name);
      })
    }
  })
}

// return an object containing {ipaddress:'',mode:''}
//   interface - Interface name to get the info for
//    callback - Called back with the info or error if there was an error
RaspberryPiNetworkManager.prototype.getInfo = function(interface, callback) {
////##
//log.debug("netDebug#### GETTING INFO")
  ifconfig.status(interface,function(err,ifstatus){
    if(err)return callback(err);
    iwconfig.status(interface,function(err,iwstatus){
      if(err)return callback(err);
      callback(null,{ssid : (iwstatus.ssid || '<Unknown>'), ipaddress:ifstatus.ipv4_address,mode:iwstatus.mode})
    })
  })
}

// Return a list of IP addresses (the local IP for all interfaces)
RaspberryPiNetworkManager.prototype.getLocalAddresses = function() {
  var interfaces = os.networkInterfaces();
  var retval = [];
////##
//log.debug("netDebug#### GETTING ADDRESS")
  interface.array.forEach(interface => {
    retval.push(interface[0].address);
  });
  retval.shift()

  return retval;

}

////## REPORTING
// Get the current "scan results"
// (A list of wifi networks that are visible to this client)
//   callback - Called with the network list or with an error if error
RaspberryPiNetworkManager.prototype.getNetworks = function(callback) {
////##
//log.debug("netDebug#### GETTING RESULTS OF SCAN")
  wpa_cli.scan_results(wifiInterface, callback);
}

////## REPORTING
// Intiate a wifi network scan (site survey)
//   callback - Called when scan is complete (may take a while) or with error if error
RaspberryPiNetworkManager.prototype.scan = function(callback) {
////##
//log.debug("netDebug#### SCANNING")
  wpa_cli.scan(wifiInterface, callback);
}

RaspberryPiNetworkManager.prototype.returnWifiNetworks= function() {
  this.scan(function(err, data){
    if(!err) {
      this.getNetworks(function(err, data) {
        if(!err) {
          var new_networks = 0;
          var new_network_names = [];
          for(var i in data) {
            var ssid = data[i].ssid;
            var found = false;
            for(var j in this.networks) {
                if(this.networks[j].ssid === ssid) {
                    found = true;
                    break;
                }
            }
            if(!found) {
              new_networks += 1;
              new_network_names.push(ssid);
              this.networks.push(data[i]);
             }
          }
          if(new_networks > 0) {
          ////## 
          //    log.debug('Found ' + new_networks + ' new networks. (' + new_network_names.join(',') + ')')
          }
        }
      }.bind(this));
    }
  }.bind(this));
}

////## REPORTING AND SETTING IP in AP-name
RaspberryPiNetworkManager.prototype.checkWifiHealth = function() {
  var interfaces = os.networkInterfaces();
  var wlan0Int =interfaces.wlan0;
  var apInt = interfaces.uap0;
  this.network_history = {};
////##
//log.debug("netDebug#### GETTING HEALTH")
  Object.keys(interfaces).forEach(function (interface) {
     if(interface !== "lo") {
       if(interfaces[interface]) {
        this.network_history[interface] = interfaces[interface][0].address
       }
     }
  }.bind(this));
  if(!wlan0Int){
    if(!apInt){
      log.warn('No wifi or AP trying to bring up AP');
      this._joinAP(function(err, res){
        if(err){
          log.warn("Could not bring back up AP");
        } else {
          log.info("AP back up")
        }
      });
    } else {
      log.info('No wifi, currently in AP mode');
    }
  } else {
    if(!apInt){
////##
      //log.info('NetDebug wifi is on at : ' + wlan0Int[0].address +' AP is down, rejoin AP');
      this._joinAP(function(err, res){
        if(err){
          log.warn("Could not bring back up AP");
        } else {
          log.info("AP back up")
        }
      });
    } else {
////##
      //log.info('NetDebug wifi is on at : ' + wlan0Int[0].address +' and Checking AP NAME');
      this._joinAP(function(err, res){
        if(err){
          log.warn("Could not bring back up AP");
        } else {
          log.info("AP back up")
        }
      });
////##
    }
  }
}


RaspberryPiNetworkManager.prototype.checkEthernetHealth = function(){
  var interfaces = os.networkInterfaces();
  console.log(interfaces);
  console.log('now ')
  ifconfig.status(ethernetInterface,function(err,status){
    if(err){
      console.log(err);
    } else {
      console.log(status);
    }
  })
}



////## REPORTING
RaspberryPiNetworkManager.prototype.confirmIP = function(callback) {
  var wlan0Int;
  var attempts = 60;
  var counter = 0;
  var interval = setInterval(function() { 
    var interfaces = os.networkInterfaces();
    wlan0Int  = interfaces.wlan0;
////##
//log.debug("netDebug#### GETTING IP", wlan0Int)

    if (counter == attempts || wlan0Int) { 
      if(counter == attempts) {
        var error = "Error connecting, please try again";
        clearInterval(interval);
        callback(error);
      } else {
        if(wlan0Int[0].family === "IPv6") {
          counter++;
        } else {
          clearInterval(interval);
          callback(null, wlan0Int[0].address);
        }
      }
    } else { 
       counter++;
    }
 }, 1000);
}

////##
// Actually do the work of joining AP mode AND updating AP name
RaspberryPiNetworkManager.prototype._joinAP = function(callback) {
//  log.info("netDebug#### PROCESSING AP mode...");
  var interfaces = os.networkInterfaces();
  var wlan0Int =interfaces.wlan0;
  var eth0Int = interfaces.eth0;
  var name = config.engine.get('name').split('0').join('').split('\n').join('').trim();
  var full_name;
  var ext;

  // Updating AP-Name
  // Then, restarting AP if we get name change; this should drop AP momentarily!
    ext =":"
    if(eth0Int) {
      ext = ext + eth0Int[0].address;
    } else if (wlan0Int) {
      ext = ext + wlan0Int[0].address;
    } else {
      ext = "";
    }
    full_name = name + ext;
//  log.debug("netDebug#### NAME-TEST " + full_name + " vs " + last_name) 
  if (full_name !== last_name) {
    // SSID is limited to 32 char; so makes long names challenging, as in:
    // 'ted-dev:169.254.225.224:192.168.1.109'
    // So best to prioritize display for ethernet, until a better idea ...
    //     TODO: chop tool names that are too long
    log.debug("n#### NEW full_name " + full_name); 
    var network_config = config.engine.get('network');
    network_config.wifi.mode = 'ap';
    config.engine.set('network', network_config);
    commands.takeDown("uap0",(err, result)=>{
      log.debug('taken down AP')
      console.log(err);
      console.log(result);
      commands.addApInterface((err, result) => {
        log.debug('Adding AP int')
        console.log(err);
        console.log(result);
        commands.bringUp('uap0', (err, result)=> {
          log.debug('bringing up');
          console.log(err);
          console.log(result);
          commands.configureApIp('192.168.42.1', (err, result) =>{
            log.debug('configure')
            console.log(err);
            console.log(result);
            commands.hostapd({
              ssid: full_name 
            }, () => {
              log.debug('hostAPD up');
              commands.dnsmasq({interface: 'uap0'}, () => {
                console.log('should be up and running AP')
                callback(err, result);
              })
            })
          })
        })
      })
    })
  }
  last_name = full_name;

}

RaspberryPiNetworkManager.prototype._disableWifi = function(callback){
  log.info("Disabling wifi...");
  //var network_config = config.engine.get('network');
  //network_config.mode = 'off';
  //config.engine.set('network', network_config);
  exec("systemctl stop hostapd wpa_supplicant",function(err,result){
    if(err)log.warn(err);
    ifconfig.down(wifiInterface,function(err, result){
      if(!err) {
    log.info("Wifi disabled.");
      }
      callback(err, result);
    });
  });
}



////## REPORTING
RaspberryPiNetworkManager.prototype._joinWifi = function(ssid, password, callback) {
  var self = this;
  ////##
log.debug("netDebug#### ATTEMPTING JOIN WIFI")
log.debug("netDebug Attempting to join wifi network: " + ssid + " with password: " + password);
  var network_config = config.engine.get('network');
  network_config.wifi.mode = 'station';
  network_config.wifi.wifi_networks = [{'ssid' : ssid, 'password' : password}];
  config.engine.set('network', network_config);
  var PSK = password;
  var SSID = ssid;
  exec('wpa_cli -i wlan0 add_network', function(error, stdout, stderr) {
    if(error !== null) {
        console.log('error: ' + error);
    }
    else {

        async.series([
            function(callback) {
                exec('wpa_cli  -i wlan0 set_network 0 ssid \'\"' + SSID + '\"\'', function(error, stdout) 
                {
                    if(error) {
                        console.error(error);                       
                    }
                    else {                      
                        console.log('SSID result: ' + stdout);
                        callback(null, stdout);
                    }                   
                });
            },
            function(callback) {
                exec('wpa_cli -i wlan0 set_network 0 psk \'\"' + PSK + '\"\'', function(error, stdout) 
                {
                    if(error) {
                        console.error(error);                       
                    }
                    else {                      
                        console.log('PSK result: ' + stdout);
                        callback(null, stdout);
                    }                   
                });
            },
            function(callback) {
              exec('wpa_cli -i wlan0 enable_network 0', function(error, stdout) 
              {
                  if(error) {
                      console.error(error);                       
                  }
                  else {                      
                      console.log('enable_network result: ' + stdout);
                      callback(null, stdout);
                  }                   
              });
          },
            function(callback) {
                exec('wpa_cli -i wlan0 save_config', function(error, stdout) 
                {
                    if(error) {
                        console.error(error);                       
                    }
                    else {                      
                        console.log('save_config result: ' + stdout);
                        callback(null, stdout);
                    }                   
                });
            }
        ], function(errs, results) {
            if(errs) throw errs;    // errs = [err1, err2, err3]
            exec('wpa_cli -i wlan0 reconfigure',  function(error, stdout) {
              if(error){
                log.error(error);
              } else {
                this.confirmIP((err, ipaddress)=>{
                  if(err){
                    callback(err);
                  } else {
                    var wifiInfo = {
                      ssid : SSID,
                      ip : ipaddress
                    }
                    callback(null, wifiInfo);
                  }
                })
              }
            }.bind(this));   
           
          }.bind(this));
    }
  }.bind(this));
}



// Issue the command to drop out of AP (and implicitly join the last remembered network)
// Function returns immediately
// RaspberryPiNetworkManager.prototype.unjoinAP = function() {
//   this.command = {
//     'cmd' : 'noap'
//   }
// }

// Do the actual work of dropping out of AP mode
//   callback - Callback called when AP mode has been exited or with error if error
RaspberryPiNetworkManager.prototype._unjoinAP = function(callback) {
  log.info("Turning off AP mode...");
  commands.stopAP((err, result) => {
    if(err){
      callback(err);
    }else {
      commands.takeDown('uap0', (err, result) => {
        callback(err, result);
      })
    }
  })
}

// Apply the wifi configuration.  If in AP, drop out of AP (and wifi config will be applied automatically)
// If in station mode, join the wifi network specified in the network configuration.
// Function returns immediately
RaspberryPiNetworkManager.prototype.applyWifiConfig = function() {
  var network_config = config.engine.get('network');
  switch(network_config.wifi.mode) {
    case 'ap':
      this.unjoinAP();
      break;
    case 'station':
      if(network_config.wifi.wifi_networks.length > 0) {
        var network = network_config.wifi.wifi_networks[0];
        this.joinWifi(network.ssid, network.password);
      } else {
        log.warn("No wifi networks defined.");
      }
      break;
    case 'off':
      // TODO - discuss about this issue. it may be not recommended to do this as a 
      //        reboot would remove wifi and the tool would be lost if you don't have a ethernet access.
      // ;this.disableWifi(); 
      break;
  }
}

/*
 * PUBLIC API BELOW HERE
 */

// Initialize the network manager.  This kicks off the state machines that process commands from here on out
RaspberryPiNetworkManager.prototype.init = function() {
////##
  commands.startWpaSupplicant((err, result) => {
//log.debug("netDebug#### START WPA")
    if(err){
      log.error('RIGHT HERE!!! wpa errored with: ' + err)
    } else {
      log.info('wpa started with: '+ result);
      setInterval(() => {
        this.returnWifiNetworks();
        this.checkWifiHealth();
        // this.checkEthernetHealth();
        // this.runEthernet();
      }, 10000);
    }
  });
  // setInterval(() => {
  //   this.returnWifiNetworks();
  //   this.checkWifiHealth();
  //   // this.checkEthernetHealth();
  //   // this.runEthernet();
  // }, 10000);
  // this._joinAP(function(err, res){
  //   if(err){
  //     console.log(err)
  //   } else {
  //     setTimeout(
  //       function () {
  //         commands.startWpaSupplicant((err, result) => {
  //           if(err){
  //             log.error('wpa errored with: ' + err)
  //           } else {
  //             log.info('wpa started with: '+ res);
  //           }
  //         })
  //       }, 10000);
  //   }
  // }.bind(this));
}


////## REPORTING
// Get a list of the available wifi networks.  (The "scan results")
//   callback - Called with list of wifi networks or error if error
RaspberryPiNetworkManager.prototype.getAvailableWifiNetworks = function(callback) {
  // TODO should use setImmediate here
////##
//log.debug("netDebug#### GET AVAILABLE NET")
  callback(null, this.networks);
}

// Connect to the specified wifi network.
//   ssid - The network ssid to connect to
//    key - The network key
RaspberryPiNetworkManager.prototype.connectToAWifiNetwork= function(ssid,key,callback) {
  // TODO a callback is passed here, but is not used.  If this function must have a callback, we should setImmediate after issuing the wifi command
  this._joinWifi(ssid, key, callback);
}


// Enable the wifi
//   callback - Called when wifi is enabled or with error if error
RaspberryPiNetworkManager.prototype.turnWifiOn=function(callback){
  //callback(new Error('Not available on the edison wifi manager.'));
    ifconfig.status(wifiInterface,function(err,status){
        if(!status.up){
            ifconfig.up(wifiInterface,function(err, data) {
                callback(err);
            }.bind(this));
        } else {
            callback();
        }
  }.bind(this));
}

// Disable the wifi
//   callback - Called when wifi is disabled or with error if error
RaspberryPiNetworkManager.prototype.turnWifiOff=function(callback){
  //callback(new Error('Not available on the edison wifi manager.'));
  this.disableWifi();
}

// Get the history of connected wifi networks
//   callback - Called with a list of networks
RaspberryPiNetworkManager.prototype.getWifiHistory=function(callback){
  callback(null, this.network_history);
}

// Enter AP mode
//   callback - Called once the command has been issued (but does not wait for the system to enter AP)
RaspberryPiNetworkManager.prototype.turnWifiHotspotOn=function(callback){
  log.info("Going to turn wifi hotspot")
  this.joinAP();
  callback(null);
}

// Get network status
//   callback - Called with network status or with error if error
RaspberryPiNetworkManager.prototype.getStatus = function(callback) {
////##
//log.debug("netDebug#### GETTING STATUS")
  ifconfig.status(callback);
  //var status = {'wifi' : {}}
}

// Set the network identity
// This sets the hostname, SSID to `name` and the root password/network key to `password`
//    identity - Object of this format {name : 'thisismyname', password : 'thisismypassword'}
//               Identity need not contain both values - only the values specified will be changed
//    callback - Called when identity has been changed or with error if error
RaspberryPiNetworkManager.prototype.setIdentity = function(identity, callback) {
  async.series([
    function set_name(callback) {
      if(identity.name) {
        log.info("Setting network name to " + identity.name);
        jedison("set name '" + identity.name + "'", callback);
      } else {
        callback(null);
      }
    }.bind(this),

    function set_name_config(callback) {
      if(identity.name) {
        config.engine.set('name', identity.name, callback);
      } else {
        callback(null);
      }
    }.bind(this),

    function set_password(callback) {
      if(identity.password) {
        log.info("Setting network password to " + identity.password);
        jedison("set password '" + identity.password + "'", callback);
      } else {
        callback(null);
      }
    }.bind(this),

    function set_password_config(callback) {
      if(identity.password) {
        config.engine.set('password', identity.password, callback);
      } else {
        callback(null);
      }
    }.bind(this)

    ],

    function(err, results) {
        if(err) {
            log.error(err);
            typeof callback === 'function' && callback(err);
        } else {
            typeof callback === 'function' && callback(null, this);
        }
    }.bind(this)
  );
}

// Check to see if this host is online
//   callback - Called back with the online state, or with error if error
RaspberryPiNetworkManager.prototype.isOnline = function(callback) {
  setImmediate(callback, null, this.mode === 'station');
}

// Turn the ethernet interface on
//   callback - Called when the ethernet interface is up or with error if error
RaspberryPiNetworkManager.prototype.turnEthernetOn=function(callback) {
  ifconfig.up(ethernetInterface,callback);
}

// Turn the ethernet interface off
//   callback - Called when the ethernet interface is up or with error if error
RaspberryPiNetworkManager.prototype.turnEthernetOff=function(callback) {
  ifconfig.down(ethernetInterface,callback);
}

// Enable DHCP for the provided interface
//   interface - The interface to update
//   callback - Called when complete, or with error if error
RaspberryPiNetworkManager.prototype.enableDHCP=function(interface, callback) {
log.debug('Enabling DHCP on ' + interface);
udhcpc.enable({interface: interface},callback)
}

// Disable DHCP for the provided interface
//   interface - The interface to update
//    callback - Called when complete, or with error if error
RaspberryPiNetworkManager.prototype.disableDHCP=function(interface, callback) {
log.debug('Disabling DHCP on ' + interface);
  udhcpc.disable(interface,callback);
}

// Start the internal DHCP server on the provided interface
//   interface - The interface on which to start the DHCP server
//    callback - Called when the DHCP server has been started, or with error if error
RaspberryPiNetworkManager.prototype.startDHCPServer=function(interface, callback) {
  var ethernet_config = config.engine.get('network').ethernet;
  var options = {
    interface: interface,
    tmpPath: tmpPath,
    start: ethernet_config.default_config.dhcp_range.start || '192.168.44.20',
    end: ethernet_config.default_config.dhcp_range.end || '192.168.44.254',
    option: {
      router: ethernet_config.default_config.ip_address || '192.168.44.1',
      subnet: ethernet_config.default_config.netmask || '255.255.255.0',
      dns: ethernet_config.default_config.dns || ["8.8.8.8"]
    }
  };
  udhcpd.enable(options,callback);
}

// Stop the internal DHCP server on the provided interface
//   interface - The interface on which to stop the DHCP server
//    callback - Called when the DHCP server has been stopped, or with error if error
RaspberryPiNetworkManager.prototype.stopDHCPServer=function(interface, callback) {
  udhcpd.disable({interface:interface,tmpPath:tmpPath},callback);
}

// Set the ip address for the provided interface to the provided value
//   interface - The interface to update
//          ip - The IP address, eg: '192.168.44.50'
//    callback - Called when the address has been set or with error if error
RaspberryPiNetworkManager.prototype.setIpAddress=function(interface, ip, callback) {
  if(!ip)return callback("no ip specified !");
  ifconfig.status(interface, function(err, status) {
    if(err)return callback(err,status);
    var options = {
      interface: interface,
      ipv4_address: ip,
      ipv4_broadcast: status.ipv4_broadcast || DEFAULT_BROADCAST,
      ipv4_subnet_mask: status.ipv4_subnet_mask || DEFAULT_NETMASK
    };
    ifconfig.up(options, callback);
  });
}

// Set the netmask for the provided interface to the provided value
//   interface - The interface to update
//     netmask - The netmask, eg: '255.255.255.0'
//    callback - Called when the netmask has been set or with error if error
RaspberryPiNetworkManager.prototype.setNetmask=function(interface, netmask, callback) {
  if(!netmask)return callback("no netmask specified !");
  ifconfig.status(interface, function(err, status) {
    if(err)return callback(err,status);
    if(!status.ipv4_address)return callback('interface ip address not configured !');
    var options = {
      interface: interface,
      ipv4_address: status.ipv4_address,
      ipv4_broadcast: netmask,
      ipv4_subnet_mask: status.ipv4_subnet_mask || DEFAULT_NETMASK
    };
    ifconfig.up(options, callback);
  });
}
// Set the gateway IP for the provided interface to the provided value
//   interface - The interface to update
//     gateway - The gateway, eg: '255.255.255.0'
//    callback - Called when the gateway has been set or with error if error
RaspberryPiNetworkManager.prototype.setGateway=function(gateway, callback) {
  exec('route add default gw '+ gateway, function(s) {
    callback(null);
  });
}

// Take the configuration stored in the network config and apply it to the currently running instance
// This function returns immediately
RaspberryPiNetworkManager.prototype.applyNetworkConfig=function(){
  this.applyWifiConfig();
  // TODO - Why is this commented out?
//  this.applyEthernetConfig();
}

// Take the ethernet configuration stored in the network config and apply it to the currently running instance
// TODO - Cleanup indentation below
// This function returns immediately (but takes a while to complete)
RaspberryPiNetworkManager.prototype.applyEthernetConfig=function(){
  var self = this;
  var ethernet_config = config.engine.get('network').ethernet;
  ifconfig.status(ethernetInterface,function(err,status){
    if(status.up && status.running){
      async.series([
        self.disableDHCP.bind(this,ethernetInterface),
        self.stopDHCPServer.bind(this,ethernetInterface)
      ],function(err,results){
        if(err) {
          log.warn(err);
        }
        this.emit('network', {'mode':'ethernet'});
        log.info("ethernet is in "+ethernet_config.mode+" mode");
        switch(ethernet_config.mode) {
          case 'static':
            async.series([
              self.setIpAddress.bind(this,ethernetInterface,ethernet_config.default_config.ip_address),
              self.setNetmask.bind(this,ethernetInterface,ethernet_config.default_config.netmask),
              self.setGateway.bind(this,ethernet_config.default_config.gateway)
            ],function(err,results){
              if(err) log.warn(err);
              else log.info("Ethernet static configuration is set");
            });
            break;

          case 'dhcp':
            self.enableDHCP(ethernetInterface,function(err){
              if(err)return log.warn(err);
              log.info("Ethernet dynamic configuration is set");
            });
            break;

          case 'magic':
            self.enableDHCP(ethernetInterface,function(err){
              setTimeout(function(){
                ifconfig.status(ethernetInterface,function(err,status){
                  if(err)log.warn(err);
                  if(status.ipv4_address!==undefined) {// we got a lease !
                      this.networkInfo.wired = status.ipv4_address;
        log.info("[magic mode] An ip address was assigned to the ethernet interface : "+status.ipv4_address);
                      return;
      }
      else{ // no lease, stop the dhcp client, set a static config and launch a dhcp server.
                    async.series([
                      self.disableDHCP.bind(this,ethernetInterface),
                      self.setIpAddress.bind(this,ethernetInterface,ethernet_config.default_config.ip_address),
                      self.setNetmask.bind(this,ethernetInterface,ethernet_config.default_config.netmask),
                      self.setGateway.bind(this,ethernet_config.default_config.gateway),
                      self.startDHCPServer.bind(this,ethernetInterface)
                  ],function(err,results){
                      if(err) log.warn(err);
                      else log.info("[magic mode] No dhcp server found, switched to static configuration and launched a dhcp server...");
                  });
                  }
                }.bind(this));
              }.bind(this),DHCP_MAGIC_TTL);
            }.bind(this));
            break;

          case 'off':
          default:
            break;
        }
      }.bind(this));
    }
  }.bind(this));
}

// This function is the main process for ethernet.
// TODO - cleanup indentation below
// Basically, it looks for media to be plugged or unplugged, and applies the correct
// configuration accordingly.
RaspberryPiNetworkManager.prototype.runEthernet = function(){
  var self = this;
  function checkEthernetState(){
    var oldState = this.ethernetState;
    ifconfig.status(ethernetInterface,function(err,status){
        if(!err && status.up && status.running){
            try {

            this.network_history[null] = {
                ssid : null,
                ipaddress : status.ipv4_address,
                last_seen : Date.now()
            }
      this.networkInfo.wired = status.ipv4_address;
            } catch(e) {
                log.warn('Could not save ethernet address in network history.')
            }
            this.ethernetState = "plugged";
            var network_config = config.engine.get('network')
            try {
                if(!network_config.wifi.enabled) {
                    if(this.wifiStatus != 'disabled') {
                        this.turnWifiOff()
                    }
                }
            } catch(e) {
                log.error(e);
            }
        }else{
            this.ethernetState = "unplugged";
        }
        if(this.ethernetState!==oldState){
            switch(this.ethernetState) {
                case "plugged":
                    log.info("ethernet cable was plugged");
                    this.applyEthernetConfig();
                    break;
                case "unplugged":
                    log.info("Ethernet cable was unplugged.");
                    this.enableWifi();
                    break;
                default:
                    log.error("Unknown ethernet state. (Bad error)");
                    break;
            }
        }
    }.bind(this));
  }
    checkEthernetState.bind(this)();
  setInterval(checkEthernetState.bind(this),ETHERNET_SCAN_INTERVAL);

}

exports.NetworkManager = RaspberryPiNetworkManager
