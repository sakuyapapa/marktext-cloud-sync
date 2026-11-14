import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { GitSync } from '../../../src/main/sync/git'

const git = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })

const makeRepos = (): { root: string; workspace: string; remote: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'marktext-git-'))
  const workspace = path.join(root, 'docs')
  const remote = path.join(root, 'remote.git')
  fs.mkdirSync(workspace, { recursive: true })
  git(['init', '--bare', '-b', 'main', remote], root)
  return { root, workspace, remote }
}

describe('git provider', () => {
  it('initialises the workspace, commits and pushes to an empty remote', async () => {
    const { root, workspace, remote } = makeRepos()
    try {
      fs.writeFileSync(path.join(workspace, 'a.md'), '# a', 'utf8')
      const sync = new GitSync(workspace, {
        remoteUrl: remote,
        branch: 'main',
        userName: 'MarkText Sync',
        userEmail: 'sync@example.com'
      })

      const first = await sync.syncNow()
      expect(first.committed).toBe(true)
      expect(first.pushed).toBe(true)
      expect(first.conflicts).toEqual([])

      // The commit reached the bare remote.
      const log = git(['log', '--oneline', 'main'], remote)
      expect(log).toContain('docs: sync')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('is a no-op when nothing changed', async () => {
    const { root, workspace, remote } = makeRepos()
    try {
      fs.writeFileSync(path.join(workspace, 'a.md'), '# a', 'utf8')
      const sync = new GitSync(workspace, {
        remoteUrl: remote,
        branch: 'main',
        userName: 'Sync',
        userEmail: 'sync@example.com'
      })
      await sync.syncNow()
      const second = await sync.syncNow()

      expect(second.committed).toBe(false)
      expect(second.pushed).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a workspace nested inside another repository', async () => {
    const { root, workspace } = makeRepos()
    try {
      git(['init', '-b', 'main'], root)
      const sync = new GitSync(workspace, {
        remoteUrl: path.join(root, 'other.git'),
        branch: 'main',
        userName: '',
        userEmail: ''
      })

      const result = await sync.test()

      expect(result.ok).toBe(false)
      expect(result.message).toContain('inside the Git repository')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
