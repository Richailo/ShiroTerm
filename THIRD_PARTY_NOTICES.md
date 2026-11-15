# Third-party notices

ShiroTerm uses Electron (MIT, with Chromium and other third-party components),
React (MIT), xterm.js and its fit addon (MIT), ssh2 (MIT), Lucide (ISC), and
Simple Icons (CC0-1.0). Dependency license files remain in the packaged
node_modules. Electron's LICENSE and LICENSES.chromium.html are distributed
beside the application executable. Development tooling is listed in package.json.

Platform and product names and logos belong to their respective owners.
ShiroTerm is an independent project and is not affiliated with Termius,
Microsoft, the Linux Foundation, or the products identified by host icons.

RDP clients (Windows Remote Desktop and Remmina) are separate system applications
and are not bundled with ShiroTerm.

The separate ShiroTerm Server container includes unmodified Bitwarden CLI
2026.10.1. Its license and third-party notices are retained in the installed npm
package under `/usr/local/lib/node_modules/@bitwarden/cli`. The upstream license
information and corresponding source are available at
https://github.com/bitwarden/clients/tree/cli-v2026.10.1. This component is a
separate process; it is not included in the ShiroTerm desktop packages.
