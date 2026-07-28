import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { assertPublicAddress } from "#ingest/address";
import { IngestSecurityError } from "#ingest/errors";
import type {
  IngestNetwork,
  NetworkResponse,
  ResolvedAddress,
  ResponseHeaders
} from "#ingest/types";

export const responseHeader = (
  headers: ResponseHeaders,
  name: string
): string | undefined => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (typeof value === "string" || value === undefined) return value;
  return value.join(", ");
};

const defaultResolve = async (hostname: string): Promise<readonly ResolvedAddress[]> => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.flatMap((entry) =>
    entry.family === 4 || entry.family === 6
      ? [{ address: entry.address, family: entry.family }]
      : []);
};

export const resolveAndPin = async (url: URL, network: IngestNetwork): Promise<string> => {
  const addresses = await (network.resolve ?? defaultResolve)(url.hostname);
  if (addresses.length === 0) {
    throw new IngestSecurityError("DNS_NO_ADDRESS", "source hostname resolved to no addresses");
  }
  const validated = addresses.map((entry) => assertPublicAddress(entry.address));
  const selected = validated[0];
  if (selected === undefined) {
    throw new IngestSecurityError("DNS_NO_ADDRESS", "source hostname resolved to no addresses");
  }
  return selected;
};

const builtInRequest = (
  url: URL,
  dialAddress: string,
  signal: AbortSignal
): Promise<NetworkResponse> => new Promise((resolve, reject) => {
  const request = (url.protocol === "https:" ? httpsRequest : httpRequest)({
    protocol: url.protocol,
    hostname: dialAddress,
    ...(url.port === "" ? {} : { port: Number(url.port) }),
    method: "GET",
    path: `${url.pathname}${url.search}`,
    headers: {
      accept: "text/html, application/xhtml+xml, text/plain, text/markdown",
      "accept-encoding": "gzip, deflate, br",
      host: url.host,
      "user-agent": "cardnews-foundry/1"
    },
    agent: false,
    ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
    rejectUnauthorized: true,
    signal
  }, (response) => resolve({
    statusCode: response.statusCode ?? 0,
    headers: response.headers,
    body: response,
    close: () => response.destroy()
  }));
  request.once("error", reject);
  request.end();
});

export const requestPinned = async (
  url: URL,
  address: string,
  network: IngestNetwork,
  signal: AbortSignal
): Promise<NetworkResponse> => {
  if (network.request !== undefined) return network.request({ url, address, signal });
  const dialAddress = network.dialAddress?.(address, url.hostname) ?? address;
  return builtInRequest(url, dialAddress, signal);
};
