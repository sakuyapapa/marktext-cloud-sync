/**
 * Git-backed sync: the workspace is a repository (or becomes one) and a run is
 * add + commit + pull --rebase + push. History, diffs and rollback come from Git
 * itself, which is why this provider stores no state of its own.
 */

import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { GitSyncConfig, GitSyncResult } from '@shared/types/sync'

const GIT_TIMEOUT_MS = 120_000

interface GitOutput {
  stdout: string
  stderr: string
}

export class GitError extends Error {
  public readonly stderr: string

  constructor(message: string, stderr: string) {
    super(message)
    this.name = 'GitError'
    this.stderr = stderr
  }
}

const execGit = (args: string[], cwd: string): Promise<GitOutput> =>
  new Promise<GitOutput>((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          // Never let a credential prompt hang a background sync.
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: 'echo'
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(error.message, stderr ?? ''))
          return
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    )
  })

const isGitRepoRoot = (dir: string): boolean => fs.existsSync(path.join(dir, '.git'))

export class GitSync {
  private readonly config: GitSyncConfig
  private readonly workspaceDir: string

  constructor(workspaceDir: string, config: GitSyncConfig) {
    this.workspaceDir = workspaceDir
    this.config = config
  }

  private get branch(): string {
    return this.config.branch?.trim() || 'main'
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const { workspaceDir, config } = this
    if (!config.remoteUrl) return { ok: false, message: 'Remote URL is empty' }
    if (!fs.existsSync(workspaceDir)) return { ok: false, message: 'Workspace folder does not exist' }
    try {
      if (isGitRepoRoot(workspaceDir)) {
        const { stdout } = await execGit(['remote', 'get-url', 'origin'], workspaceDir)
        return { ok: true, message: `Repository origin: ${stdout.trim()}` }
      }
      // A workspace nested inside another repository would make a run commit
      // unrelated project files, so refuse instead of guessing.
      const { stdout } = await execGit(['rev-parse', '--show-toplevel'], workspaceDir)
      const repoRoot = stdout.trim()
      if (repoRoot && path.resolve(repoRoot) !== path.resolve(workspaceDir)) {
        return {
          ok: false,
          message: `This folder is inside the Git repository ${repoRoot}; open that repository root as the sync workspace, or use WebDAV for a single sub-folder`
        }
      }
      return { ok: true, message: 'Folder will be initialised as a Git repository on the first sync' }
    } catch (error) {
      // `rev-parse` failing means "not a repository", which the first sync can fix.
      if (error instanceof GitError && /not a git repository/i.test(error.stderr)) {
        return { ok: true, message: 'Folder will be initialised as a Git repository on the first sync' }
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  private async ensureRepository(): Promise<void> {
    const { workspaceDir, config } = this
    if (!isGitRepoRoot(workspaceDir)) {
      await execGit(['init'], workspaceDir)
    }
    if (config.userName) await execGit(['config', 'user.name', config.userName], workspaceDir)
    if (config.userEmail) await execGit(['config', 'user.email', config.userEmail], workspaceDir)

    let hasOrigin = false
    try {
      await execGit(['remote', 'get-url', 'origin'], workspaceDir)
      hasOrigin = true
    } catch {
      hasOrigin = false
    }
    if (!hasOrigin) {
      await execGit(['remote', 'add', 'origin', config.remoteUrl], workspaceDir)
    } else {
      await execGit(['remote', 'set-url', 'origin', config.remoteUrl], workspaceDir)
    }
  }

  private async listConflicts(): Promise<string[]> {
    try {
      const { stdout } = await execGit(['diff', '--name-only', '--diff-filter=U'], this.workspaceDir)
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  async syncNow(): Promise<GitSyncResult> {
    const { workspaceDir } = this
    const result: GitSyncResult = {
      committed: false,
      pushed: false,
      conflicts: [],
      message: ''
    }

    await this.ensureRepository()

    await execGit(['add', '-A'], workspaceDir)
    let staged = ''
    try {
      const { stdout } = await execGit(['diff', '--cached', '--name-only'], workspaceDir)
      staged = stdout.trim()
    } catch {
      staged = ''
    }
    if (staged) {
      const message = `docs: sync ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`
      await execGit(['commit', '-m', message], workspaceDir)
      result.committed = true
    }

    try {
      // An empty remote has no branch to rebase onto; `ls-remote` tells us
      // before we turn "couldn't find remote ref" into a hard failure.
      const { stdout: refs } = await execGit(
        ['ls-remote', '--heads', 'origin', this.branch],
        workspaceDir
      )
      if (!refs.trim()) {
        result.message = result.committed ? 'Committed' : 'Nothing to commit'
      } else {
        // `--autostash` keeps local edits safe when the rebase needs a clean tree.
        await execGit(['pull', '--rebase', '--autostash', 'origin', this.branch], workspaceDir)
        result.message = result.committed ? 'Committed and pulled' : 'Pulled'
      }
    } catch (error) {
      const conflicts = await this.listConflicts()
      if (conflicts.length > 0) {
        try {
          await execGit(['rebase', '--abort'], workspaceDir)
        } catch {
          // Abort is best-effort; the conflict list below is what matters.
        }
        result.conflicts = conflicts
        result.message = `Merge conflicts in ${conflicts.length} file(s); resolve them manually, then sync again`
        return result
      }
      const detail = error instanceof GitError ? error.stderr.trim() || error.message : String(error)
      throw new Error(`git pull failed: ${detail}`)
    }

    try {
      await execGit(['push', '-u', 'origin', `HEAD:${this.branch}`], workspaceDir)
    } catch (error) {
      // A brand-new empty remote rejects nothing, but an unreachable one should
      // be reported rather than silently treated as success.
      const detail = error instanceof GitError ? error.stderr.trim() || error.message : String(error)
      throw new Error(`git push failed: ${detail}`)
    }
    result.pushed = true
    return result
  }
}
