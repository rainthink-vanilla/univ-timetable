// 下载 EAS 构建产物（Node 走 OpenSSL，绕开 Windows schannel 的 SEC_E_NO_CREDENTIALS）
// 用法：node scripts/download-apk.cjs [artifactUrl] [outFile]
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://expo.dev/artifacts/eas/DvHHOlcwe68wHTsv2neoPrUHtJbJ4RJDZx_orj5PNr4.apk';
const url = process.argv[2] || DEFAULT_URL;
const out = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(__dirname, '..', 'univ-timetable-1.1.0.apk');

function get(u, redirects) {
  redirects = redirects || 0;
  const mod = u.startsWith('https') ? https : http;
  mod
    .get(u, { headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects > 8) {
          console.error('Too many redirects');
          process.exit(1);
        }
        const next = new URL(res.headers.location, u).toString();
        res.resume();
        get(next, redirects + 1);
        return;
      }
      if (res.statusCode !== 200) {
        console.error('HTTP', res.statusCode, u);
        res.resume();
        process.exit(1);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const f = fs.createWriteStream(out);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (total) process.stdout.write(`\r${((received / total) * 100).toFixed(1)}%`);
      });
      res.pipe(f);
      f.on('finish', () => {
        f.close();
        const size = fs.statSync(out).size;
        console.log(`\nOK ${out} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      });
    })
    .on('error', (e) => {
      console.error('ERR', e.message);
      process.exit(1);
    });
}

get(url);
