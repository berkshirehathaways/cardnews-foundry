# Contract version compatibility

Contract records use `major.minor.patch` strings in `schemaVersion`.

- Readers support major version `1` exactly.
- A record with a newer minor or patch in major `1` is accepted only when it
  validates against the installed schema. The validation result marks newer
  minor versions with `forwardMinor: true`.
- Unknown major versions fail closed with `UNSUPPORTED_SCHEMA_MAJOR`.
- There is no migration engine. Regenerate an unsupported record from its last
  validated checkpoint using a reader that supports that major version.
