const fs = require('fs')
const path = require('path')
const dir = path.join(process.cwd(), 'packages', 'desktop', 'static', 'locales')
const patch = (file, syncPull, pullLabel) => {
  const full = path.join(dir, file)
  const json = JSON.parse(fs.readFileSync(full, 'utf8'))
  json.contextMenu.syncPull = syncPull
  json.preferences.sync.actions.pull = pullLabel
  fs.writeFileSync(full, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log('patched', file)
}
patch('zh-CN.json', '立即拉取（只下载）', '只拉取')
patch('en.json', 'Pull only (download)', 'Pull only')
