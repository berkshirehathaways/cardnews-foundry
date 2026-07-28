import type { SourceEnvelope } from "#contracts";

export type ResolvedAddress = {
  readonly address: string;
  readonly family: 4 | 6;
};

export type ResponseHeaders = Readonly<Record<string, string | readonly string[] | undefined>>;

export type NetworkResponse = {
  readonly statusCode: number;
  readonly headers: ResponseHeaders;
  readonly body: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  readonly close?: () => void;
};

export type PinnedRequest = {
  readonly url: URL;
  readonly address: string;
  readonly signal: AbortSignal;
};

export type IngestNetwork = {
  readonly resolve?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly dialAddress?: (validatedAddress: string, hostname: string) => string;
  readonly request?: (request: PinnedRequest) => Promise<NetworkResponse>;
};

export type UrlIngestOptions = {
  readonly network?: IngestNetwork;
  readonly deadlineMs?: number;
  readonly now?: () => Date;
  readonly signal?: AbortSignal;
  readonly onAcceptedBytes?: (bytes: Uint8Array) => Promise<void>;
};

export type LocalIngestInput = {
  readonly file: string;
  readonly allowedRoot?: string;
  readonly now?: () => Date;
  readonly onAcceptedBytes?: (bytes: Uint8Array) => Promise<void>;
};

export type IngestResult = SourceEnvelope;
