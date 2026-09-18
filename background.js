/* ============================================================
 * Background Service Worker
 * 职责:
 * 1. 转发 popup ↔ content 的消息
 * 2. 根据当前 tab 状态,更新扩展图标 title
 *    (content 状态变化时主动推送 STATE_CHANGED,即时刷新,不等 tab complete)
 * ============================================================ */

function titleFor(disguised) {
  return '知乎摸鱼助手 ' + (disguised ? '· 阅读中' : '· 已关闭');
}

// 图标状态同步:读取 content state 更新 title
function updateIcon(tabId) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { type: 'GET_STATE' }, function (resp) {
    if (chrome.runtime.lastError || !resp) return;
    if (!resp.onZhihu) {
      chrome.action.setTitle({ tabId: tabId, title: '知乎摸鱼助手(非知乎页面)' });
      return;
    }
    chrome.action.setTitle({ tabId: tabId, title: titleFor(resp.disguised) });
  });
}

chrome.tabs.onActivated.addListener(function (info) {
  updateIcon(info.tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === 'complete') updateIcon(tabId);
});

// 消息路由
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  // 来自 content script:状态变化,即时刷新该 tab 的图标 title
  if (sender.tab && msg.type === 'STATE_CHANGED') {
    chrome.action.setTitle({ tabId: sender.tab.id, title: titleFor(msg.disguised) });
    return;
  }

  // 来自 popup(没有 tab)—— 转发给当前激活 tab
  if (!sender.tab) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs.length) {
        sendResponse && sendResponse({ ok: false, reason: 'no-active-tab' });
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, msg, function (resp) {
        if (chrome.runtime.lastError) {
          sendResponse && sendResponse({ ok: false, reason: 'no-content-script' });
        } else {
          sendResponse && sendResponse(resp);
        }
      });
    });
    return true; // 异步响应
  }
});
