import assert from "node:assert/strict";
import test from "node:test";

const ingest = await import("../../src/ingest/index.ts");

const blockedAddresses = [
  ["IPv4 unspecified", "0.0.0.0"],
  ["IPv4 private 10/8", "10.1.2.3"],
  ["IPv4 CGNAT", "100.64.0.1"],
  ["IPv4 loopback", "127.0.0.2"],
  ["IPv4 link-local", "169.254.20.1"],
  ["cloud metadata", "169.254.169.254"],
  ["IPv4 private 172/12", "172.31.255.255"],
  ["IPv4 private 192.168/16", "192.168.2.1"],
  ["IPv4 documentation TEST-NET-1", "192.0.2.1"],
  ["IPv4 documentation TEST-NET-2", "198.51.100.4"],
  ["IPv4 documentation TEST-NET-3", "203.0.113.9"],
  ["IPv4 multicast", "239.1.2.3"],
  ["IPv4 reserved", "240.0.0.1"],
  ["IPv6 unspecified", "::"],
  ["IPv6 loopback", "::1"],
  ["IPv6 unique-local", "fd12:3456::1"],
  ["IPv6 link-local", "fe80::1"],
  ["IPv6 multicast", "ff02::1"],
  ["IPv6 documentation", "2001:db8::1"],
  ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
  ["IPv4-mapped private normalized hex", "0:0:0:0:0:ffff:c0a8:101"],
  ["IPv4-compatible private", "::10.0.0.1"],
  ["NAT64-mapped metadata", "64:ff9b::169.254.169.254"]
];

for (const [label, address] of blockedAddresses) {
  test(`Given ${label}, When the public-address boundary validates it, Then it rejects with security class 3`, () => {
    // Given
    const candidate = address;

    // When
    const validate = () => ingest.assertPublicAddress(candidate);

    // Then
    assert.throws(validate, (error) =>
      error instanceof ingest.IngestSecurityError
      && error.code === "BLOCKED_ADDRESS"
      && error.exitClass === 3);
  });
}

test("Given a globally routable IPv4 and IPv6 address, When the boundary validates them, Then both remain eligible for pinning", () => {
  // Given
  const addresses = ["93.184.216.34", "2606:4700:4700::1111"];

  // When
  const validated = addresses.map(ingest.assertPublicAddress);

  // Then
  assert.deepEqual(validated, addresses);
});

test("Given a hostname-like or zone-qualified value, When the address boundary validates it, Then it fails closed", () => {
  // Given
  const malformed = ["localhost", "fe80::1%lo0", "999.1.1.1"];

  // When
  const attempts = malformed.map((address) => {
    try {
      ingest.assertPublicAddress(address);
      return "accepted";
    } catch (error) {
      return error.code;
    }
  });

  // Then
  assert.deepEqual(attempts, ["INVALID_RESOLVED_ADDRESS", "INVALID_RESOLVED_ADDRESS", "INVALID_RESOLVED_ADDRESS"]);
});
