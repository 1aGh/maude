// client/v2/search/search-keywords.js — V2-4.6: the words a person types that are NOT in a row's label.
//
// ⌘K matches a row's label first (strong), then these words + the row's where-path (weak). The tables
// are small on purpose and every entry earns its place from a probe in test/v2-search.test.ts ("hub",
// "figma", "api key", "print guides", "New artboard — A4"). No fuzzy library: typo tolerance for
// canvases/artboards is index/match.ts's; for actions a miss is a miss.
//
// Keyed by registry action id, never by label, so a label change (CONTRACT §3) cannot orphan a word.

/** action id → extra words. */
export const ACTION_KEYWORDS = Object.freeze({
  'view.advanced-open-all': ['open advanced', 'advanced mode', 'expert', 'pro'],
  'view.advanced-close-all': ['close advanced', 'fold advanced', 'reset advanced'],
  // Hub / cloud — Michal's "hub" is the team server and the cloud (CONTRACT §7 words: "Maude Cloud",
  // "team server"); the Diagnostics rows and the sync actions answer it too.
  'sync.resync': ['hub', 'cloud', 'sync'],
  'sync.download-all': ['hub', 'cloud', 'sync', 'download'],
  'diag.sync': ['hub', 'cloud', 'team server', 'sync'],
  'diag.ai': ['api key', 'claude', 'connected', 'ai setup'],
  'diag.ai-recheck': ['api key', 'claude', 'connected'],
  'help.ai-readiness': ['api key', 'claude', 'connected'],
  'diag.address': ['hub', 'url', 'port', 'localhost'],
  'diag.process': ['pid', 'server'],
  'diag.project-folder': ['path', 'finder', 'reveal', 'folder'],
  'diag.logs': ['log', 'console', 'debug'],
  'diag.server': ['status', 'running', 'reconnecting', 'live'],
  'import.figma': ['figma', 'import', 'frames'],
  'import.brand': ['brand', 'logo', 'website', 'import'],
  // Print.
  'view.print-guides': ['print', 'bleed', 'crop marks', 'margins', 'guides'],
  'artboard.new-a4': ['a4', 'paper', 'print', 'page', 'new artboard'],
  'artboard.new-letter': ['us letter', 'paper', 'print', 'page', 'new artboard'],
  'artboard.new-desktop': ['web', 'screen', 'new artboard'],
  'artboard.new-laptop': ['web', 'screen', 'new artboard'],
  'artboard.new-tablet': ['ipad', 'new artboard'],
  'artboard.new-mobile': ['phone', 'iphone', 'new artboard'],
  'canvas.new': ['create', 'blank', 'board', 'brief'],
  'canvas.new-video': ['video', 'film', 'movie', 'new video'],
  'canvas.duplicate': ['copy', 'clone'],
  'canvas.move': ['folder', 'organise', 'organize'],
  'canvas.trash': ['delete', 'remove', 'bin'],
  'canvas.copy-link': ['share', 'url', 'address'],
  'canvases.pin': ['favourite', 'favorite', 'keep on top'],
  'canvases.unpin': ['favourite', 'favorite', 'remove from pinned'],
  'canvases.sort': ['order', 'recent', 'name', 'kind', 'folders on top'],
  'canvas.close': ['tab'],
  'video.assemble': ['clips', 'footage', 'reel', 'edit video'],
  'view.design-system': ['design system', 'tokens', 'brand', 'components', 'colours', 'colors'],
  'settings.theme': ['dark mode', 'light mode', 'appearance', 'theme'],
  'view.trash': ['deleted', 'bin', 'restore', 'recycle'],
  'view.assets': ['pictures', 'images', 'media', 'files'],
  'view.exports': ['downloads', 'export jobs'],
  'view.hidden-files': ['sidecar', 'dotfiles', 'meta json', 'css files'],
  'view.pin-panels': ['dock', 'float', 'side'],
  'view.layers-panel': ['layers', 'tree', 'separate'],
  'view.inspector': ['properties', 'raw css', 'attributes', 'raw'],
  'view.inspector-on-select': ['auto open', 'properties'],
  'view.timeline-keep-open': ['video', 'clips'],
  'view.minimap': ['map', 'overview', 'navigator'],
  'view.zoom-controls': ['zoom', 'percent'],
  'canvases.refresh': ['reload tree', 'resync files', 'refresh'],
  'export.open': ['pdf', 'png', 'download', 'save as', 'print', 'svg', 'zip'],
  'export.rerun-last': ['again', 'repeat', 'last export'],
  'handoff.open': ['code', 'developers', 'shadcn', 'registry', 'production'],
  'ai.generate': ['image', 'picture', 'voice', 'video', 'generate', 'create with ai'],
  'ai.draw-mark': ['logo', 'icon', 'svg', 'illustration'],
  'ai.chat': ['assistant', 'claude', 'ask ai', 'chat'],
  'share.open': ['invite', 'people', 'collaborate', 'link'],
  'share.copy-link': ['link', 'url', 'share'],
  'history.open': ['versions', 'changes', 'branch', 'restore', 'undo history'],
  'view.comments': ['feedback', 'threads', 'review'],
  'present.canvas': ['presentation', 'slideshow', 'full screen'],
  'canvas.reload': ['refresh', 'reload', 'restart canvas'],
  'account.switch': ['sign out', 'log out', 'account', 'github'],
  'help.shortcuts': ['keys', 'keyboard', 'hotkeys', 'cheat sheet'],
  'help.guides': ['docs', 'documentation', 'manual'],
  'help.whats-new': ['changelog', 'release notes', 'updates'],
  'help.tour': ['walkthrough', 'onboarding', 'learn'],
  'help.report-bug': ['issue', 'feedback', 'problem'],
  'project.new': ['folder', 'create project'],
  'project.open': ['folder', 'switch project'],
  'nav.home': ['projects', 'start'],
  'home.open': ['projects', 'start'],
  'settings.open': ['preferences', 'options', 'config'],
});

/**
 * Settings rows: label (when the where-path's last segment is a verb or a detail, not the thing) and
 * extra words. Keyed by the row's `testid` from settings-model.js; the two `sync-setting-syncFiles`
 * rows are one control and one result.
 */
export const SETTINGS_SEARCH = Object.freeze({
  'settings-theme': { keywords: ['dark mode', 'light mode', 'appearance'] },
  'settings-open-dashboard': { keywords: ['browser', 'cloud', 'hub', 'account'] },
  'settings-inspector-vocabulary': { keywords: ['designer', 'developer', 'css', 'words'] },
  'settings-canvas-view': { keywords: ['zoom', 'minimap', 'grid', 'view'] },
  'panel-side-<id>': { label: 'Panel positions', keywords: ['left', 'right', 'dock', 'layout'] },
  'cloud-account': {
    label: 'Maude Cloud account',
    keywords: ['hub', 'cloud', 'email', 'sign out', 'sign in'],
  },
  'settings-github': { label: 'GitHub', keywords: ['git', 'sign in', 'account', 'token'] },
  'settings-ai-keys': {
    label: 'AI images, video and voice',
    keywords: ['api key', 'api keys', 'keys', 'provider', 'token', 'byok'],
  },
  'figma-connect-card': {
    label: 'Figma',
    keywords: ['token', 'api key', 'connection', 'import', 'test connection'],
  },
  'settings-hub-address': {
    label: 'Hub address',
    keywords: ['hub', 'cloud', 'server', 'url', 'self hosted'],
  },
  'settings-team-server-add': {
    label: 'Add a team server…',
    keywords: ['hub', 'self hosted', 'server', 'team', 'invite'],
  },
  'settings-app-version': { label: 'Version', keywords: ['app version', 'about', 'build'] },
  'settings-update-restart': {
    label: 'Update',
    keywords: ['check for updates', 'restart now', 'new version', 'upgrade'],
  },
  'settings-server-build': { label: 'Server build', keywords: ['version', 'about', 'build'] },
  'settings-keys-store': {
    label: 'Keys are kept in',
    keywords: ['api key', 'keychain', 'secret', 'password', 'storage'],
  },
  'settings-claude-autosetup': {
    label: 'Install and sign in automatically',
    keywords: ['claude code', 'claude', 'install', 'api key', 'sign in'],
  },
  'settings-copy-draw': {
    label: 'Draw a mark with the SVG agent',
    keywords: ['claude code', 'copy command', 'logo', 'svg'],
  },
  'settings-copy-brand': {
    label: 'Import a brand from the terminal',
    keywords: ['claude code', 'copy command', 'terminal'],
  },
  'settings-transcription': {
    label: 'Subtitles',
    keywords: ['whisper', 'transcription', 'engine', 'captions', 'model'],
  },
  'settings-keyframes': {
    label: 'Video keyframes',
    keywords: ['gemma', 'engine', 'model', 'footage'],
  },
  'sync-setting-syncFiles': {
    label: 'Sync project files',
    keywords: ['hub', 'propagate deletions', 'canvases only', 'cloud', 'team'],
  },
  'sync-setting-firstAnchor': {
    label: 'When a folder first links',
    keywords: ['hub', 'link', 'cloud', 'sync'],
  },
  'sync-ownership-adopt': {
    label: 'Who keeps .design/',
    keywords: ['hub', 'hand over', 'owner', 'sync'],
  },
});
