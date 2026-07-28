import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
};

export const makeSyntheticPng = (variant) => {
  const width = 320;
  const height = 320;
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const orbit = Math.abs(Math.hypot(x - 160, y - 160) - 92) < 7;
      const grid = x % 64 < 5 || y % 64 < 5;
      const seed = (x - 160) ** 2 + (y - 160) ** 2 < 42 ** 2;
      const color = variant === 0
        ? seed ? [201, 91, 43] : orbit ? [39, 107, 82] : [246, 240, 228]
        : grid ? [216, 205, 187] : x > y ? [23, 33, 43] : [82, 96, 109];
      scanlines[offset] = color[0];
      scanlines[offset + 1] = color[1];
      scanlines[offset + 2] = color[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
};
