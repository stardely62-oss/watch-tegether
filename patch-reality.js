
const http = require('http');
const fs = require('fs');

const token = process.env.TOKEN;
const domain = process.env.DOMAIN || 'kino.barasek.net';
const dest = process.env.DEST || '127.0.0.1:8443';
const cfg = '/tmp/rw-patched-config.json';

const req = http.request({
  socketPath: '/run/remnawave-internal-lC1C4ugu7w.sock',
  path: '/internal/get-config?token=' + token,
  method: 'GET',
}, (res) => {
  let d = '';
  res.on('data', (c) => { d += c; });
  res.on('end', () => {
    try {
      const j = JSON.parse(d);
      let found = false;
      for (const ib of (j.inbounds || [])) {
        if (ib.protocol !== 'vless') continue;
        const rs = ib.streamSettings && ib.streamSettings.realitySettings;
        if (!rs) continue;
        found = true;
        const names = new Set(rs.serverNames || []);
        names.add(domain);
        names.add('icloud.com');
        names.add('www.icloud.com');
        rs.serverNames = Array.from(names);
        rs.target = dest;
        rs.dest = dest;
      }
      if (!found) {
        console.error('no-reality-inbound');
        process.exit(2);
      }
      fs.writeFileSync(cfg, JSON.stringify(j));
      console.log('patched-ok', cfg, 'names=', j.inbounds.find(i => i.streamSettings && i.streamSettings.realitySettings).streamSettings.realitySettings.serverNames.join(','));
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  });
});
req.on('error', (e) => { console.error(String(e)); process.exit(1); });
req.end();
