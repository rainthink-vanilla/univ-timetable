/**
 * 生成测试用 PNG（纯 Node，无第三方依赖）
 *
 * 用途：`verify-v160.mjs` 要把一张**真实图片文件**装进浏览器文件选择框，
 * 才能走通「选图 → 校验规格 → 裁剪」的真实链路。
 * 仓库自带 assets 都是 512×512（低于最短边 600px 的规格），因此这里现场生成。
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * 生成一张四象限不同颜色的 PNG（便于人眼确认裁剪位置）。
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function makePng(width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (width * 3 + 1);
    raw[rowOff] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowOff + 1 + x * 3;
      const left = x < width / 2;
      const top = y < height / 2;
      // 四象限：左上红 / 右上蓝 / 左下绿 / 右下黄
      const c = top ? (left ? [220, 60, 60] : [60, 90, 220]) : left ? [60, 180, 100] : [230, 190, 60];
      raw[p] = c[0];
      raw[p + 1] = c[1];
      raw[p + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
