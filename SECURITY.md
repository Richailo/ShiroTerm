# Security

Report security issues privately through the repository owner's GitHub profile
before opening a public issue. Do not attach credentials, private keys, tokens,
profile files or unredacted connection logs.

Passwords and remembered device tokens use Electron safeStorage with the
operating system's secret provider. The Linux basic_text fallback is rejected.
Hosts, usernames, file paths, snippets and trusted host fingerprints are local
metadata and are not encrypted as a whole. Protect your OS account and backups.
SSH host keys require approval; changed keys require a fresh decision.
Telnet is unencrypted and should be used only on trusted networks.

Synchronization is optional and uses HTTPS certificate verification. No private
server address or private CA is bundled. A deployment may explicitly supply
SHIROTERM_SYNC_CA pointing to its CA PEM file. Never disable TLS verification.
The independent profile-encryption passphrase is retained only in memory.

Downloads are currently unsigned; compare the SHA-256 checksums and obtain
packages only from this repository's Releases page.
