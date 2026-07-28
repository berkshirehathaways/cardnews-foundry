import { inflateSync } from "node:zlib";
import { RenderError } from "./errors.mjs";

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const paeth = (left, up, upperLeft) => {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
};

export const inspectPng = (bytes) => {
  const data = Buffer.from(bytes);
  if (data.length < signature.length || !data.subarray(0, signature.length).equals(signature)) {
    throw new RenderError("PNG_SIGNATURE_INVALID", "render output is not PNG");
  }
  let offset = signature.length;
  let width;
  let height;
  let depth;
  let colorType;
  const idat = [];
  const chunks = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
    }
    if (type === "IDAT") idat.push(body);
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (width === undefined || height === undefined || depth !== 8 || ![2, 6].includes(colorType)) {
    throw new RenderError("PNG_FORMAT_INVALID", "PNG must be 8-bit RGB or RGBA");
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const decoded = inflateSync(Buffer.concat(idat));
  if (decoded.length !== (stride + 1) * height) throw new RenderError("PNG_DATA_INVALID", "scanline size mismatch");
  let prior = Buffer.alloc(stride);
  let opaque = true;
  for (let row = 0; row < height; row += 1) {
    const start = row * (stride + 1);
    const filter = decoded[start];
    const source = decoded.subarray(start + 1, start + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let column = 0; column < stride; column += 1) {
      const raw = source[column] ?? 0;
      const left = column >= channels ? current[column - channels] ?? 0 : 0;
      const up = prior[column] ?? 0;
      const upperLeft = column >= channels ? prior[column - channels] ?? 0 : 0;
      if (filter === 0) current[column] = raw;
      else if (filter === 1) current[column] = (raw + left) & 255;
      else if (filter === 2) current[column] = (raw + up) & 255;
      else if (filter === 3) current[column] = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) current[column] = (raw + paeth(left, up, upperLeft)) & 255;
      else throw new RenderError("PNG_FILTER_INVALID", `unsupported filter ${filter}`);
    }
    if (channels === 4) {
      for (let column = 3; column < stride; column += 4) {
        if (current[column] !== 255) opaque = false;
      }
    }
    prior = current;
  }
  return {
    width,
    height,
    opaque,
    colorType,
    chunks,
    signature: data.subarray(0, 8).toString("hex"),
    colorSpace: "srgb"
  };
};
