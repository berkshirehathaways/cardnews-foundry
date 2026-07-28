import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = fileURLToPath(new URL("./fixtures/", import.meta.url));

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type, data) => {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
};

const pngWithIdat = ({ width, height, colorType, idatChunks, interlace = 0 }) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    ...idatChunks.map((payload) => pngChunk("IDAT", payload)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
};

const png = ({ width, height, colorType, pixelBytes }) => pngWithIdat({
  width,
  height,
  colorType,
  idatChunks: [deflateSync(Buffer.concat([Buffer.from([0]), pixelBytes]), { level: 9 })]
});

const jpegBase64 = "/9j/4AAQSkZJRgABAgAAAQACAAD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABfAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAAABwEAAAAAAAAAAAAAAAAAAgUEBrR1NhEAAAQHAQAAAAAAAAAAAAAAAAUEBgIHNbWzdjd0/8AAEQgAAQACAwESAAISAAMSAP/aAAwDAQACEQMRAD8Apo3zqPnMq5AjfOo+cyrkFAQ0Mr8KTBABDQyvwpMEAx+bHU35tThuikJsdTfm1OG6KR//2Q==";

const oversizedHeaderPng = (width, height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 0, 0, 0, 0]))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
};

const oversizedEarlyPng = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(9000, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    Buffer.from([0])
  ]);
};

await mkdir(path.join(fixtureRoot, "nested"), { recursive: true });
const rgba = png({
  width: 2,
  height: 1,
  colorType: 6,
  pixelBytes: Buffer.from([255, 0, 0, 128, 0, 0, 255, 255])
});
const rgb = png({
  width: 2,
  height: 1,
  colorType: 2,
  pixelBytes: Buffer.from([255, 0, 0, 0, 0, 255])
});
const jpg = Buffer.from(jpegBase64, "base64");
const corruptJpg = Buffer.from(jpg);
corruptJpg[4] = 0;
corruptJpg[5] = 1;
const validRgbStream = deflateSync(Buffer.from([0, 255, 0, 0, 0, 0, 255]), { level: 9 });
const splitAt = Math.ceil(validRgbStream.length / 2);

await Promise.all([
  writeFile(path.join(fixtureRoot, "nested", "Alpha Card.weird"), rgba),
  writeFile(path.join(fixtureRoot, "opaque-png.bin"), rgb),
  writeFile(path.join(fixtureRoot, "user-jpeg.bin"), jpg),
  writeFile(path.join(fixtureRoot, "mislabeled-png.bin"), Buffer.from("not an image", "utf8")),
  writeFile(path.join(fixtureRoot, "jpeg-named-png.bin"), jpg),
  writeFile(path.join(fixtureRoot, "truncated-png.bin"), rgba.subarray(0, rgba.length - 3)),
  writeFile(path.join(fixtureRoot, "truncated-jpeg.bin"), jpg.subarray(0, jpg.length - 1)),
  writeFile(path.join(fixtureRoot, "corrupt-jpeg-segment.bin"), corruptJpg),
  writeFile(path.join(fixtureRoot, "corrupt-png-crc.bin"), Buffer.concat([
    rgba.subarray(0, 29),
    Buffer.from([rgba[29] ^ 0xff]),
    rgba.subarray(30)
  ])),
  writeFile(path.join(fixtureRoot, "trailing-png-polyglot.bin"), Buffer.concat([rgb, Buffer.from("<script>")])),
  writeFile(path.join(fixtureRoot, "oversized-dimension-png.bin"), oversizedHeaderPng(9000, 1)),
  writeFile(path.join(fixtureRoot, "oversized-early-png.bin"), oversizedEarlyPng()),
  writeFile(path.join(fixtureRoot, "oversized-pixels-png.bin"), oversizedHeaderPng(8000, 8000)),
  writeFile(path.join(fixtureRoot, "invalid-zlib-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [Buffer.from([0xde, 0xad, 0xbe, 0xef])]
  })),
  writeFile(path.join(fixtureRoot, "truncated-zlib-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [validRgbStream.subarray(0, validRgbStream.length - 2)]
  })),
  writeFile(path.join(fixtureRoot, "overrun-zlib-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [deflateSync(Buffer.from([0, 255, 0, 0, 0, 0, 255, 99]), { level: 9 })]
  })),
  writeFile(path.join(fixtureRoot, "underrun-zlib-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [deflateSync(Buffer.from([0, 255, 0]), { level: 9 })]
  })),
  writeFile(path.join(fixtureRoot, "invalid-filter-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [deflateSync(Buffer.from([5, 255, 0, 0, 0, 0, 255]), { level: 9 })]
  })),
  writeFile(path.join(fixtureRoot, "split-idat-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [validRgbStream.subarray(0, splitAt), validRgbStream.subarray(splitAt)]
  })),
  writeFile(path.join(fixtureRoot, "trailing-zlib-data-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [Buffer.concat([validRgbStream, Buffer.from([0xde, 0xad, 0xbe, 0xef])])]
  })),
  writeFile(path.join(fixtureRoot, "concatenated-zlib-members-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    idatChunks: [Buffer.concat([validRgbStream, deflateSync(Buffer.from([0]), { level: 9 })])]
  })),
  writeFile(path.join(fixtureRoot, "interlaced-png.bin"), pngWithIdat({
    width: 2,
    height: 1,
    colorType: 2,
    interlace: 1,
    idatChunks: [validRgbStream]
  }))
]);
