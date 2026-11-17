# Built-in cloud sync

This fork adds a **cloud sync** layer to MarkText. The editor stays fully
local-first: it reads and writes plain files in a workspace folder, and a
main-process service mirrors that folder to a remote in the background.

Two providers ship in this fork:

| Provider | Transport                         | Good for                                                       |
| -------- | --------------------------------- | -------------------------------------------------------------- |
| WebDAV   | HTTP(S) PROPFIND/PUT/GET/DELETE   | JianguoYun, Nextcloud, Synology, Alist, any WebDAV share       |
| Git      | `git` on `PATH`                   | Teams that already keep docs in GitLab/GitHub, want real diffs |

## Using it

1. Open **Preferences → Sync** (new category at the bottom of the sidebar).
2. Pick the local folder to mirror (`docs`, a project folder, …).
3. Choose the provider and fill in its settings.
4. **Test connection**, then **Save**, then **Sync now** for the first run.

Once saved and enabled, the service starts when the app starts:

- a `chokidar` watcher pushes local edits after `debounceMs` (default 3 s),
- a timer pulls remote changes every `intervalMinutes` (default 10, `0`
  disables the timer),
- every run reports status to all windows over `mt::sync::status`.

## How a run decides what to do

The engine keeps a per-workspace state file in `userData/sync-state/<hash>.json`
mapping each relative path to the content hash and remote mtime it last agreed
on. A run compares three inputs — current local file, current remote entry,
last agreed state — and classifies every path:

| Local | Remote | Action                                                        |
| ----- | ------ | ------------------------------------------------------------- |
| new    | absent | upload                                                        |
| changed| unchanged | upload                                                      |
| unchanged | changed | download                                                   |
| changed | changed | compare bytes; identical → record, different → conflict policy |
| unchanged | deleted | move local copy to `userData/sync-trash/<hash>/` and forget it |
| deleted | unchanged | delete the remote copy                                     |
| changed | deleted | resurrect by uploading the local copy                         |

Nothing is ever overwritten silently. With the default `keep-both` policy the
losing version is written next to the document as
`<name>.conflict-YYYYMMDD-HHmmss-<side>.md`, which the engine ignores on later
scans so conflict copies never ping-pong.

Sync state, trash and credentials live under `userData`, never inside the
synced folder, so they cannot sync themselves into a loop.

## Git provider

The workspace must be a repository root (a sub-folder of a bigger repository is
rejected on purpose: a run would commit unrelated project files). A run is
`git add -A` → commit (skipped when nothing changed) → `git pull --rebase
--autostash` (skipped when the remote branch is empty) → `git push -u`. Merge
conflicts abort the rebase, are listed in the status and are **not** resolved
automatically.

## Credentials

WebDAV passwords are encrypted with Electron `safeStorage` (DPAPI on Windows,
Keychain on macOS) and stored in `userData/cloud-sync.json`. If `safeStorage` is
unavailable the value falls back to plain text in that file.

## Native modules are optional in this fork

`keytar` and `native-keymap` are compiled against Electron's ABI. A build
machine without the C++ toolchain cannot produce them, so this fork loads both
lazily:

- `keytar` falls back to `userData/secrets-fallback.json` (mode 0600),
- `native-keymap` falls back to an empty key map (shortcuts keep working on the
  US layout, layout-aware re-mapping does not).

Behaviour is unchanged on machines where the native builds exist.

## Code layout

```
packages/desktop/src/main/sync/
  engine.ts    provider-agnostic diff/merge engine (no Electron imports)
  webdav.ts    minimal WebDAV client + provider adapter
  git.ts       git-backed sync
  store.ts     config persistence + secret encryption
  service.ts   watcher, timer, status broadcast, IPC glue
packages/desktop/src/main/ipc/sync.ts
  IPC handlers (get/set/test/run/status/choose-workspace)
packages/desktop/src/renderer/src/prefComponents/sync/index.vue
  Preferences panel
packages/desktop/test/unit/specs/cloud-sync.spec.ts
  engine + WebDAV client tests (in-memory provider and a real HTTP server)
packages/desktop/test/unit/specs/git-sync.spec.ts
  git provider tests against a local bare repository
```

## Building

```bash
pnpm install          # postinstall needs Python + MSVC Build Tools for native modules
pnpm typecheck        # vue-tsc
pnpm test:unit        # vitest
pnpm build:win        # NSIS installer, output in dist/
```

If the native modules cannot be compiled, `pnpm install --ignore-scripts`
followed by `pnpm exec electron-vite build` still produces a working `out/`
bundle thanks to the optional loaders above; only the keyring and
layout-aware shortcuts degrade.

## Known limits

- No CRDT/OT: two people editing the *same* file simultaneously get a conflict
  copy, not a merged document.
- Remote change detection uses the mtime a server reports. Servers with
  one-second granularity can miss two edits inside the same second; local edits
  are always detected because they are content-hashed.
- Deleting a folder locally while the remote copy changed re-downloads it
  instead of deleting (safer default).
- The Git provider requires credentials to be usable non-interactively
  (`GIT_TERMINAL_PROMPT=0` is set for every run), e.g. a stored credential
  helper or a token in the remote URL.

## AI 触发的拉取（无 UI 入口）

MarkText 不提供任何“只拉取”的菜单或按钮。该能力只暴露给 AI 助手：对话里说“把云端最新文档拉下来”，模型会调用 `pull_cloud_documents` 工具，主进程用当前配置的云同步连接（飞书 / Git / WebDAV）执行**只下载**：

- 只写本地工作区，不上传本地改动；
- 与本地改动冲突时按“两边都保留”落 `*.conflict-*` 副本；
- 未配置云同步时会返回提示，引导去 偏好设置 → 云同步。

实现：`main/ai/tools.ts`（工具定义 + 执行）+ `main/ai/client.ts`（function calling 循环，最多 3 轮）。
