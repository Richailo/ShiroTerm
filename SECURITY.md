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

The optional server runs behind HTTPS and stores encrypted profile envelopes,
salted password hashes and hashed session tokens in SQLite. Browser operations
use HttpOnly/Secure/SameSite cookies, origin checks and CSRF tokens. Keep its
data volume, secrets and backups private. Revoke all restored sessions after a
backup restore. Server administrators should operate a single replica per database.

Vaultwarden is an explicit optional trust boundary: the server can access login
secrets while a user has unlocked their vault there. Unlock keys are held only
in memory with a lifetime limit; encrypted CLI caches are separated by account.
Do not enable this integration on an untrusted or shared server operator's host.
