'use strict';
const os = require('node:os');

const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|vbox|loopback|bluetooth|tailscale|zerotier|vpn|tap|tun|npcap|radmin|hamachi/i;

/**
 * Adresses IPv4 du PC sur le réseau local, la plus probable en premier
 * (Wi-Fi / Ethernet en 192.168.x.x ou 10.x.x.x ; cartes virtuelles et VPN en dernier).
 */
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (VIRTUAL.test(name)) score -= 100;
      if (/wi-?fi|wlan|ethernet|eth|en\d|wl/i.test(name)) score += 10;
      if (a.address.startsWith('192.168.')) score += 5;
      else if (a.address.startsWith('10.')) score += 3;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score -= 5; // souvent WSL / Docker
      list.push({ name, address: a.address, score });
    }
  }
  return list.sort((x, y) => y.score - x.score);
}

module.exports = { lanAddresses };
