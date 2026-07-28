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

const adler32 = (bytes) => {
  let first = 1;
  let second = 0;
  for (const byte of bytes) {
    first = (first + byte) % 65521;
    second = (second + first) % 65521;
  }
  return ((second << 16) | first) >>> 0;
};

const stableDeflate = (bytes) => {
  const blocks = [Buffer.from([0x78, 0x01])];
  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === bytes.length ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    blocks.push(header, bytes.subarray(offset, offset + length));
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(bytes));
  blocks.push(checksum);
  return Buffer.concat(blocks);
};

export const makeSyntheticPng = (variant) => {
  const width = 640;
  const height = 640;
  const center = width / 2;
  const blend = (background, foreground, coverage) =>
    background.map((channel, index) =>
      Math.round(channel + (foreground[index] - channel) * coverage)
    );
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const radius = Math.hypot(x + 0.5 - center, y + 0.5 - center);
      const orbitCoverage = Math.min(1, Math.max(0, 14.5 - Math.abs(radius - 184)));
      const seedCoverage = Math.min(1, Math.max(0, 84.5 - radius));
      const grid = x % 128 < 10 || y % 128 < 10;
      const background = [246, 240, 228];
      const color = variant === 0
        ? blend(
            blend(background, [39, 107, 82], orbitCoverage),
            [201, 91, 43],
            seedCoverage
          )
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
    chunk("IDAT", stableDeflate(scanlines)),
    chunk("IEND", Buffer.alloc(0))
  ]);
};
