# Install and connect

## macOS machine installation

Install Git, npm, Node.js 24.12 or newer, and Python 3. From a terminal, clone the server and run its installer.

```sh
git clone https://github.com/paulboutin/crap-mcp.git
cd crap-mcp
npm run install:machine
```

The installer starts a per-user service, connects the supported agent clients it finds on your PATH, and links the four skills. Open a **new chat in the Git checkout you want to assess**. The skill registers that checkout with the service. You can see registered projects in the [local dashboard](http://127.0.0.1:47731/).

## Run a first assessment

| Client | Try the security review skill |
| --- | --- |
| Codex | `Use $crap-security-review to scan this project and show the findings.` |
| Claude Code | `/crap-security-review Scan this project and show the findings.` |
| OpenCode | `Use the crap-security-review skill to scan this project and show the findings.` |

Security and accessibility can assess supported source without a coverage run. For numeric function CRAP, configure a designated test command that generates line-level coverage. [Configure a checkout](settings.md).

## Other platforms and connections

From a server clone, run `npm ci` and `npm run machine`. Connect the agent’s HTTP MCP entry to `http://127.0.0.1:47731/mcp` and install the four directories from `.agents/skills/` in the client's supported skill directory. For a client that uses stdio, build the server and pass the target checkout as an argument to `dist/server.js`. [Connection examples](https://github.com/paulboutin/crap-mcp#connect-an-agent).

If you add an agent client after the macOS install, run `bash ~/.local/share/crap-mcp/current/scripts/connect-clients.sh` and start a new chat. To upgrade an existing installation, update the clone and run the machine installer again.
