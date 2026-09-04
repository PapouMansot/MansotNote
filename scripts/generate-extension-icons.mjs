/**
 * Générateur d'icônes PNG minimalistes pour l'extension Web Clipper.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';

mkdirSync('extension/icons', { recursive: true });

function createColoredPng(size, r = 79, g = 70, b = 229) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    
    let crc = 0xffffffff;
    for (let i = 0; i < body.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ body[i]) & 0xff];
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const IHDR = chunk('IHDR', ihdrData);

  const rowLength = 1 + size * 3;
  const rawData = Buffer.alloc(rowLength * size);
  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0;
    for (let x = 0; x < size; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const IDAT = chunk('IDAT', compressed);
  const IEND = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, IHDR, IDAT, IEND]);
}

const p16 = createColoredPng(16);
const p48 = createColoredPng(48);
const p128 = createColoredPng(128);

writeFileSync('extension/icons/icon16.png', p16);
writeFileSync('extension/icons/icon48.png', p48);
writeFileSync('extension/icons/icon128.png', p128);
console.log('✅ Icônes PNG générées avec succès pour l\'extension');
