import { isIP } from "node:net";
import { IngestSecurityError } from "#ingest/errors";

const parseIpv4 = (address: string): number => {
  const octets = address.split(".");
  if (octets.length !== 4) {
    throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a malformed IPv4 address");
  }
  let value = 0;
  for (const octet of octets) {
    if (!/^(?:0|[1-9]\d{0,2})$/u.test(octet)) {
      throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a malformed IPv4 address");
    }
    const parsed = Number(octet);
    if (parsed > 255) {
      throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a malformed IPv4 address");
    }
    value = value * 256 + parsed;
  }
  return value >>> 0;
};

const ipv4In = (value: number, base: number, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
};

const blockedIpv4 = (value: number): boolean => [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4]
].some(([base, bits]) => base !== undefined && bits !== undefined && ipv4In(value, base, bits));

const parseIpv6 = (address: string): bigint => {
  let normalized = address.toLowerCase();
  const lastColon = normalized.lastIndexOf(":");
  if (normalized.includes(".")) {
    if (lastColon < 0) {
      throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a malformed IPv6 address");
    }
    const ipv4 = parseIpv4(normalized.slice(lastColon + 1));
    normalized = `${normalized.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  if (normalized.split("::").length > 2) {
    throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a malformed IPv6 address");
  }
  const [leftText, rightText] = normalized.split("::");
  const left = leftText === "" ? [] : leftText?.split(":") ?? [];
  const right = rightText === undefined || rightText === "" ? [] : rightText.split(":");
  const omitted = rightText === undefined ? 0 : 8 - left.length - right.length;
  const groups = [...left, ...Array.from({ length: omitted }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) {
    throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a malformed IPv6 address");
  }
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
};

const ipv6In = (value: bigint, base: bigint, bits: number): boolean => {
  const shift = 128n - BigInt(bits);
  return (value >> shift) === (base >> shift);
};

const ipv4FromEmbeddedIpv6 = (value: bigint): number | undefined => {
  const high96 = value >> 32n;
  if (high96 === 0xffffn || high96 === 0n || high96 === 0x0064ff9b0000000000000000n) {
    return Number(value & 0xffffffffn);
  }
  if (ipv6In(value, 0x20020000000000000000000000000000n, 16)) {
    return Number((value >> 80n) & 0xffffffffn);
  }
  return undefined;
};

const blockedIpv6 = (value: bigint): boolean => {
  const embedded = ipv4FromEmbeddedIpv6(value);
  if (embedded !== undefined && blockedIpv4(embedded)) return true;
  const blockedPrefixes: readonly (readonly [bigint, number])[] = [
    [0n, 128],
    [1n, 128],
    [0x01000000000000000000000000000000n, 64],
    [0x20010000000000000000000000000000n, 32],
    [0x20010002000000000000000000000000n, 48],
    [0x20010010000000000000000000000000n, 28],
    [0x20010db8000000000000000000000000n, 32],
    [0xfc000000000000000000000000000000n, 7],
    [0xfe800000000000000000000000000000n, 10],
    [0xff000000000000000000000000000000n, 8]
  ];
  if (blockedPrefixes.some(([base, bits]) => ipv6In(value, base, bits))) return true;
  return !ipv6In(value, 0x20000000000000000000000000000000n, 3);
};

export const assertPublicAddress = (address: string): string => {
  if (address.includes("%")) {
    throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "zone-qualified addresses are forbidden");
  }
  const family = isIP(address);
  if (family === 4) {
    if (blockedIpv4(parseIpv4(address))) {
      throw new IngestSecurityError("BLOCKED_ADDRESS", "resolved address is not globally routable");
    }
    return address;
  }
  if (family === 6) {
    if (blockedIpv6(parseIpv6(address))) {
      throw new IngestSecurityError("BLOCKED_ADDRESS", "resolved address is not globally routable");
    }
    return address;
  }
  throw new IngestSecurityError("INVALID_RESOLVED_ADDRESS", "resolver returned a non-IP address");
};
