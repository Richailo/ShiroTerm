ShiroTerm 0.2.1 fixes HTTPS trust for private synchronization servers and cleans
up explanatory text across the desktop interface.

- Uses public and operating-system certificate roots on Windows and Linux.
- Adds a HTTPS certificate picker, fingerprint confirmation and saved trust scoped
  to the exact server origin. Hostname and expiry checks remain enabled.
- Removes redundant help paragraphs from Sync Server, Vaults, host settings,
  authentication, themes, SFTP, Keychain and other main screens.

- Works locally without an account or a synchronization server.
- Optional ShiroTerm Server: sign in once in your browser; the OS-protected
  device session reconnects automatically on startup and retries after outages.
- Linux passwords and remembered sessions require an unlocked system keyring.
- Download and extract the archive for your system, then run ShiroTerm.exe
  (Windows) or ./ShiroTerm (Linux). Keep the whole extracted folder together.
- Windows packages are unsigned. Linux RDP requires Remmina and its RDP plugin.
- See README.md for requirements, sync configuration and current limitations.

Verify downloads against SHA256SUMS.txt. This release includes portable x64
packages; source builds can also target arm64.
