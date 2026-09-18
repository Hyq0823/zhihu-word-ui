/**
 * Popup 脚本 — 状态显示 + 伪装开关 + 全部配置读写(chrome.storage.sync)
 * v0.8:新增 自动伪装策略 / 老板键(触发方式、覆盖画面、跳转地址) / FAB 常显开关;
 *      伪装模式按真实 pageType 显示(修复 question/profile 全显示成 A4 文档的问题)。
 * 配置写入 sync 后,content 侧 onChanged 即时热更新,无需刷新页面。
 */

function $(id) { return document.getElementById(id); }

var statusEl = $('status-val');
var modeEl = $('mode-val');
var pageTagEl = $('page-tag');
var toggleBtn = $('btn-toggle');

var els = {
  strategy: $('strategy-sel'),
  hotkey: $('hotkey-sel'),
  fab: $('fab-chk'),
  panicKey: $('panic-key-sel'),
  panicMode: $('panic-mode-sel'),
  panicUrlRow: $('panic-url-row'),
  panicUrl: $('panic-url-input')
};

// storage 键与默认值(与 content.js 常量保持一致)
var KEYS = {
  strategy: 'tdoc_strategy',
  hotkey: 'tdoc_hotkey',
  fabVisible: 'tdoc_fab_visible',
  panicKey: 'tdoc_panic_key',
  panicMode: 'tdoc_panic_mode',
  panicUrl: 'tdoc_panic_url'
};
var DEFAULTS = {
  strategy: 'detail',
  hotkey: 'dbl-space',
  fabVisible: '0',
  panicKey: 'dbl-esc',
  panicMode: 'terminal',
  panicUrl: ''
};

// pageType → 模式显示名(content.js GET_STATE 返回真实类型)
var ptLabels = {
  article: 'A4 文档 · 文章',
  question: 'A4 文档 · 问题',
  answer: 'A4 文档 · 回答',
  profile: 'A4 文档 · 主页',
  feed: '文档列表',
  other: '文档列表'
};

async function refreshState() {
  try {
    var resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (resp && resp.onZhihu) {
      pageTagEl.textContent = '知乎';
      if (resp.disguised) {
        statusEl.textContent = '伪装中';
        statusEl.className = 'val on';
        modeEl.textContent = ptLabels[resp.pageType] || '—';
        toggleBtn.textContent = '✕ 关闭文档伪装';
      } else {
        statusEl.textContent = resp.strategy === 'off' ? '已停用' : '正常浏览';
        statusEl.className = 'val';
        modeEl.textContent = resp.strategy === 'off' ? '自动伪装已停用' : '未开启';
        toggleBtn.textContent = '📄 开启文档伪装';
      }
      toggleBtn.disabled = false;
    } else {
      pageTagEl.textContent = '非知乎';
      statusEl.textContent = '非知乎页面';
      statusEl.className = 'val';
      modeEl.textContent = '—';
      toggleBtn.disabled = true;
    }
  } catch (e) {
    statusEl.textContent = '连接失败';
    toggleBtn.disabled = true;
  }
}

toggleBtn.addEventListener('click', async function () {
  try {
    await chrome.runtime.sendMessage({ type: 'TOGGLE_DISGUISE' });
    refreshState();
  } catch (e) {
    console.error(e);
  }
});

// ===== 配置:一次性读取回填,change 即写回 sync(content 侧热更新) =====
function syncUrlRow() {
  els.panicUrlRow.classList.toggle('hide', els.panicMode.value !== 'redirect');
}

function save(key, val) {
  var patch = {};
  patch[key] = val;
  chrome.storage.sync.set(patch);
}

var allKeys = Object.keys(KEYS).map(function (k) { return KEYS[k]; });
chrome.storage.sync.get(allKeys, function (r) {
  r = r || {};
  els.strategy.value = r[KEYS.strategy] || DEFAULTS.strategy;
  els.hotkey.value = r[KEYS.hotkey] || DEFAULTS.hotkey;
  els.fab.checked = r[KEYS.fabVisible] === '1';
  els.panicKey.value = r[KEYS.panicKey] || DEFAULTS.panicKey;
  els.panicMode.value = r[KEYS.panicMode] || DEFAULTS.panicMode;
  els.panicUrl.value = r[KEYS.panicUrl] || DEFAULTS.panicUrl;
  syncUrlRow();
});

els.strategy.addEventListener('change', function () { save(KEYS.strategy, els.strategy.value); refreshState(); });
els.hotkey.addEventListener('change', function () { save(KEYS.hotkey, els.hotkey.value); });
els.fab.addEventListener('change', function () { save(KEYS.fabVisible, els.fab.checked ? '1' : '0'); });
els.panicKey.addEventListener('change', function () { save(KEYS.panicKey, els.panicKey.value); });
els.panicMode.addEventListener('change', function () { save(KEYS.panicMode, els.panicMode.value); syncUrlRow(); });
els.panicUrl.addEventListener('change', function () { save(KEYS.panicUrl, els.panicUrl.value.trim()); });

refreshState();
