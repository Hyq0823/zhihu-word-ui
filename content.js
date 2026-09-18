/* ============================================================
 * 知乎摸鱼助手 v0.8 —— 浏览器级伪装 + 老板键 + 自动伪装策略
 *
 * 设计原则:
 * - 只改前端,不拦截知乎任何原生交互(链接/滚动/展开均保持原生)
 * - document_start 同步判定并注入 → 第一帧即伪装,知乎原生 UI 全程不可见
 * - CSS 负责外观(html.tdoc-* class 驱动),JS 只管 class/顶栏/FAB/路由/快捷键
 * - 知乎发版时只改 CSS 选择器
 *
 * v0.8 新增:
 * - Tab 身份伪装:标题/favicon 接管(含 Chrome 历史记录),退出伪装完整还原
 * - 老板键:双击 Esc 全屏"无害画面"(假终端/假表格/跳转工作页),与伪装正交
 * - 自动伪装策略:detail/all/manual/off 四档,storage.sync 源 + LS 镜像首帧同步读
 * - FAB 伪装态隐匿:默认不可见,hover 右下角低透明度浮现
 * - 评论区开关:默认隐藏;popup 打开后评论入口/列表以"文档批注"样式显示(交互保持原生)
 * - 正文视频屏蔽:与图片同机制(【视频 N】占位符,悬停预览/点击固定,露出原生播放器)
 * ============================================================ */
(function () {
  'use strict';

  // ---- 注入节点的 id 常量:双下划线前缀,避免与知乎自身 class/id 冲突 ----
  var FAB_ID = '__tdoc_fab__';       // 右下角悬浮切换按钮
  var CHROME_ID = '__tdoc_chrome__'; // 固定顶栏容器(腾讯文档外壳)
  var LS_KEY = 'tdoc_disguised';     // localStorage 开关键:'1' 开 / '0' 关
  var HOTKEY_KEY = 'tdoc_hotkey';    // chrome.storage.sync 里的快捷键配置键
  var DEFAULT_HOTKEY = 'dbl-space';  // 默认快捷键;可选 dbl-space | alt-q | ctrl-alt-d | off
  // ---- v0.8 配置键:chrome.storage.sync 为源(跨设备),localStorage 镜像供首帧同步读 ----
  var STRATEGY_KEY = 'tdoc_strategy';       // 自动伪装策略:detail | all | manual | off
  var STRATEGY_LS_KEY = 'tdoc_strategy_m';  // 策略的 LS 镜像键(document_start 同步读取用)
  var DEFAULT_STRATEGY = 'detail';          // 默认与旧版行为一致:详情页自动、首页手动
  var PANIC_KEY = 'tdoc_panic_key';         // 老板键:dbl-esc | off
  var PANIC_MODE_KEY = 'tdoc_panic_mode';   // 老板键画面:terminal(假终端) | sheet(假表格) | redirect(跳转)
  var PANIC_URL_KEY = 'tdoc_panic_url';     // redirect 模式跳转的工作页 URL
  var FAB_VIS_KEY = 'tdoc_fab_visible';     // 伪装态是否常显 FAB('1' 显示;默认隐匿)
  var COMMENTS_KEY = 'tdoc_comments';       // 伪装态是否显示评论区('1' 显示;默认隐藏,开启后为批注样式)
  var DEFAULT_PANIC_KEY = 'dbl-esc';
  var DEFAULT_PANIC_MODE = 'terminal';
  // ---- v0.8 注入节点 id ----
  var PANIC_ID = '__tdoc_panic__';          // 老板键全屏覆盖层
  var FAVICON_ID = '__tdoc_favicon__';      // 伪装态 favicon(蓝底白 T,呼应页内顶栏 logo)
  // 内联 PNG data URI:不远程拉取(MV3 远程代码合规 + 离线可用)
  var DOC_FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAHRSURBVGhD7ZohT8NAFMdPIjEkXBFTJMh9AAQSzxeYxBCgnSAzgGIOxxw4JHKVSILGDwXXssAIhEAISckra9O9Xnu7dqO95L3kZ+7+Wd+v1y65toxJitsPa5YtWtwRR3UB+rHafhP3OlF/TXsjy/GCusJt75Pb4gD3zizHc3G4znBH3DQO7xfGzT9u44AhnIQCsCySSSNgcGPgQZNgfN/bw4MmwcK/KMmEjG7/Pejffc2N1vkodUwVWgJwkHlW5+otdUwVpQQGw59g5/I12Dx9jrkdfE9koupdf8SZrbOXcDVx/asANLra8XMzyZI1t94dKjMqCgs0j59S8ziTrKzmYAVVmTwKCcBB8RzO4MprLrrs8jJZaAvAdY/HcUZWec3BfaHKZKElANds1qUTUUQAAAnVb8vQEpiGogJFIQEMCWhCAhgS0IQEMCSgCQlgSEATEsDAfkFWsAfG2VkwU4Hk9lBW8NhEto8uQ2kBOLNZZz2rIA+bI/xbRSgtAI0kH6tMy6xWorRA1ZBA1ZBA1ZBA1ZBA1TB4aYwHTYKtOGIDD5oEg7fdeNAkxi+6/R6eMAQ3FAhXwRZCEqgt8FHKUttfjj/2aOyOFrnjXeBgTXGj5n8BXHECTUDozbwAAAAASUVORK5CYII=';
  // body 模式 class 清单,与 content.css 的五套样式一一对应;切模式时先整体移除再添加,防残留
  var MODE_CLASSES = ['tdoc-mode-article', 'tdoc-mode-question', 'tdoc-mode-answer', 'tdoc-mode-profile', 'tdoc-mode-list'];

  // 运行时全局状态
  var state = {
    disguised: false, // 当前是否处于伪装态
    panic: false,     // 老板键覆盖层是否生效
    lastUrl: ''       // 上一次路由 URL,用于 SPA 路由变化去重
  };

  // 异步配置汇总(源:chrome.storage.sync;loadConfig 拉取 + onChanged 热更新)
  var cfg = {
    hotkey: DEFAULT_HOTKEY,
    strategy: DEFAULT_STRATEGY, // document_start 阶段先读 LS 镜像(见 bootstrap)
    panicKey: DEFAULT_PANIC_KEY,
    panicMode: DEFAULT_PANIC_MODE,
    panicUrl: '',
    fabVisible: false,
    comments: false             // 评论区默认隐藏(暴露面最小);popup 可开
  };

  // 会话内手动切换的最高优先级:null=未手动干预,true/false=用户明确意图。
  // 手动关闭后,本次浏览内路由切换不再被策略自动重开;刷新页面后重置回归策略。
  var sessionOverride = null;

  // 配置值白名单校验(storage.sync 可被同账号其他设备/调试写入脏值,一律回退默认,防逻辑分叉)
  function validStrategy(v) { return (v === 'detail' || v === 'all' || v === 'manual' || v === 'off') ? v : DEFAULT_STRATEGY; }
  function validPanicKey(v) { return v === 'off' ? 'off' : DEFAULT_PANIC_KEY; }
  function validPanicMode(v) { return (v === 'terminal' || v === 'sheet' || v === 'redirect') ? v : DEFAULT_PANIC_MODE; }
  function validHotkey(v) { return (v === 'dbl-space' || v === 'alt-q' || v === 'ctrl-alt-d' || v === 'off') ? v : DEFAULT_HOTKEY; }

  // ========== 页面类型判断(纯 URL,document_start 即可用,不依赖 DOM) ==========
  function pageType() {
    var p = location.pathname;
    // 首页/探索/关注/想法 → 信息流列表页
    if (p === '/' || p === '' || p.indexOf('/home') === 0 || p.indexOf('/explore') === 0 || p.indexOf('/follow') === 0 || p.indexOf('/pin') === 0) return 'feed';
    if (/^\/(p|column)\/[\w-]+/.test(p)) return 'article';  // 专栏文章
    if (/^\/question\/\d+/.test(p)) return 'question';      // 问题页(含回答列表)
    if (/^\/answer\/\d+/.test(p) || /^\/question\/\d+\/answer\/\d+/.test(p)) return 'answer'; // 单回答页
    if (/^\/people\/[\w-]+/.test(p) || /^\/org\/[\w-]+/.test(p)) return 'profile';            // 个人/机构主页
    return 'other'; // 其余页面:按开关走 list 模式或不伪装
  }

  // 详情页 = detail 策略下自动伪装的页面(文章/问题/回答/主页)
  function isDetailPage() {
    var pt = pageType();
    return pt === 'article' || pt === 'question' || pt === 'answer' || pt === 'profile';
  }

  // pageType → body 模式 class 映射;feed/other 统一走 list(文档目录列表风)
  function modeClassFor(pt) {
    if (pt === 'article') return 'tdoc-mode-article';
    if (pt === 'question') return 'tdoc-mode-question';
    if (pt === 'answer') return 'tdoc-mode-answer';
    if (pt === 'profile') return 'tdoc-mode-profile';
    return 'tdoc-mode-list';
  }

  // ========== Storage ==========
  // 为什么用 localStorage 而不是 chrome.storage:document_start 阶段必须"同步"读到开关
  // 才能决定首帧样式;chrome.storage 是异步回调,会错过首帧造成频闪。
  // localStorage 按 zhihu.com 域隔离,恰好符合"只在知乎生效"的语义。
  function savePrefs() { // 持久化当前开关,下次进入/刷新可同步恢复
    // 策略为 off 时固定写 '0':手动开启仅本页会话有效,刷新后不再自动伪装
    try { localStorage.setItem(LS_KEY, (state.disguised && cfg.strategy !== 'off') ? '1' : '0'); } catch (e) {}
  }
  function loadPrefs() {
    try { return localStorage.getItem(LS_KEY) === '1'; } catch (e) { return false; }
  }

  // 自动伪装策略:源在 chrome.storage.sync(跨设备同步),首帧判定读 LS 镜像
  // (镜像由 loadConfig 在拉到/变更 sync 值时写入,与开关同用"异步源 + 同步镜像"方案)
  function loadStrategyMirror() {
    try { return validStrategy(localStorage.getItem(STRATEGY_LS_KEY)); } catch (e) { return DEFAULT_STRATEGY; }
  }
  function mirrorStrategy() {
    try { localStorage.setItem(STRATEGY_LS_KEY, cfg.strategy); } catch (e) {}
  }

  // 是否伪装:会话内手动意图 × 策略 × 页面类型 三者决策
  // - sessionOverride 优先于一切策略:off 策略下手动开启后,SPA 路由切换不得静默剥离
  //   (applyConfig 在策略变更时会清 override,因此 popup 切到 off 仍会立即退出伪装)
  // - off:    从不自动伪装(仍可手动开,但不持久化,刷新即回归关闭)
  // - manual: 完全跟随用户持久化开关,详情页也不强制开(修复"详情页关不掉"问题)
  // - all:    知乎全域自动伪装
  // - detail: 详情页自动伪装,其余跟随开关(v0.7 默认行为,老用户升级无感)
  function shouldDisguise() {
    if (sessionOverride !== null) return sessionOverride;
    if (cfg.strategy === 'off') return false;
    if (cfg.strategy === 'manual') return loadPrefs();
    if (cfg.strategy === 'all') return true;
    return loadPrefs() || isDetailPage();
  }

  // ========== 固定表头 HTML(伪装核心:仿腾讯文档三段式顶栏) ==========
  // 所有按钮/下拉都是纯装饰:tabindex="-1" 不进 tab 序、不绑事件,不拦截知乎原生交互。
  // 高度预算:顶栏 48 + 标签栏 36 + 工具栏 44 + 边框 3 ≈ 131px,
  // 与 content.css 的 --tdoc-chrome-h / body padding-top 保持一致。
  var CHROME_HTML =
    // 顶栏 48px
    '<div class="tdoc-chrome-topbar">' +
      '<div class="tdoc-chrome-brand">' +
        '<div class="tdoc-chrome-logo">T</div>' +
        '<span class="tdoc-chrome-name">腾讯文档</span>' +
      '</div>' +
      '<div class="tdoc-chrome-filename" id="tdoc-filename">文档</div>' +
      '<span class="tdoc-chrome-perm">只能查看</span>' +
      '<div class="tdoc-chrome-right">' +
        '<button class="tdoc-chrome-btn" tabindex="-1">↶</button>' +
        '<button class="tdoc-chrome-btn" tabindex="-1">↷</button>' +
        '<button class="tdoc-chrome-btn-primary" tabindex="-1">分享</button>' +
      '</div>' +
    '</div>' +
    // 标签栏 36px
    '<div class="tdoc-chrome-tabs">' +
      '<div class="tdoc-chrome-tab active">开始</div>' +
      '<div class="tdoc-chrome-tab">插入</div>' +
      '<div class="tdoc-chrome-tab">页面</div>' +
      '<div class="tdoc-chrome-tab">引用</div>' +
      '<div class="tdoc-chrome-tab">审阅</div>' +
      '<div class="tdoc-chrome-tab">视图</div>' +
    '</div>' +
    // 工具栏 44px
    '<div class="tdoc-chrome-toolbar">' +
      '<div class="tdoc-chrome-tb-group"><button class="tdoc-chrome-tb-btn" tabindex="-1">↶</button><button class="tdoc-chrome-tb-btn" tabindex="-1">↷</button></div>' +
      '<div class="tdoc-chrome-tb-group"><select class="tdoc-chrome-select" tabindex="-1"><option>+插入</option></select></div>' +
      '<div class="tdoc-chrome-tb-group">' +
        '<select class="tdoc-chrome-select" tabindex="-1"><option>宋体</option></select>' +
        '<select class="tdoc-chrome-select" tabindex="-1"><option>16</option></select>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">A▾</button>' +
      '</div>' +
      '<div class="tdoc-chrome-tb-group">' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1"><b>B</b></button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1"><i>I</i></button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1"><u>U</u></button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1"><s>S</s></button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">X₂</button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">Xᵃ</button>' +
      '</div>' +
      '<div class="tdoc-chrome-tb-group">' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">•▾</button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">1.▾</button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">⬅</button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">⬌</button>' +
        '<button class="tdoc-chrome-tb-btn" tabindex="-1">≡▾</button>' +
      '</div>' +
      '<div class="tdoc-chrome-tb-group">' +
        '<select class="tdoc-chrome-select" tabindex="-1"><option>正文</option><option>标题 1</option><option>标题 2</option></select>' +
      '</div>' +
    '</div>';

  // ========== 侧栏/状态栏 HTML(以假乱真的工作区外壳) ==========
  // 左栏:目录/章节/书签 tab + 导航主体(主体内容由 collectToc/renderToc 动态注入);
  // 右栏"套模板"面板与最右图标条:纯装饰静态 HTML,不绑事件;
  // 底部状态栏:页码/字数由 updateStatus/updatePageCur 实时回填。
  // 显隐由 content.css 控制:仅宽屏 + article/question/answer 模式显示左右栏。
  var PANELS_HTML =
    '<div class="tdoc-side tdoc-side-left">' +
      '<div class="tdoc-side-tabs">' +
        '<span class="tdoc-side-tab active" data-tab="toc">目录</span>' +
        '<span class="tdoc-side-tab" data-tab="chapter">章节</span>' +
        '<span class="tdoc-side-tab" data-tab="bookmark">书签</span>' +
        '<span class="tdoc-side-tab-extra">查找和替换</span>' +
      '</div>' +
      '<div class="tdoc-side-body" id="tdoc-toc-body"></div>' +
    '</div>' +
    '<div class="tdoc-side tdoc-side-right">' +
      '<div class="tdoc-side-head">套模板<span class="tdoc-side-head-x">×</span></div>' +
      '<div class="tdoc-tpl-tabs"><span class="active">精选</span><span>通用</span><span>信纸</span><span>奖状证书</span></div>' +
      '<div class="tdoc-tpl-filter">⏷ 筛选</div>' +
      '<div class="tdoc-tpl-grid">' +
        '<div class="tdoc-tpl t1"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="tdoc-tpl t2"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="tdoc-tpl t3"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="tdoc-tpl t4"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="tdoc-tpl t5"><i></i><i></i><i></i><i></i><i></i></div>' +
        '<div class="tdoc-tpl t6"><i></i><i></i><i></i><i></i><i></i></div>' +
      '</div>' +
    '</div>' +
    '<div class="tdoc-rail">' +
      '<span class="tdoc-rail-i">✎</span>' +
      '<span class="tdoc-rail-i">◫</span>' +
      '<span class="tdoc-rail-i">▤</span>' +
      '<span class="tdoc-rail-i">⚙</span>' +
      '<span class="tdoc-rail-i">?</span>' +
    '</div>' +
    '<div class="tdoc-statusbar">' +
      '<span>页面: <span id="tdoc-page-cur">1</span>/<span id="tdoc-page-total">1</span></span>' +
      '<span>字数: <span id="tdoc-wordcount">0</span></span>' +
      '<span>拼写检查: 打开</span>' +
      '<span>校对</span>' +
      '<span class="tdoc-status-warn">⚠ 缺失字体</span>' +
      '<span class="tdoc-status-right">兼容模式&nbsp;&nbsp;100%</span>' +
    '</div>';

  var PANELS_ID = '__tdoc_panels__';

  // ========== 固定表头注入/移除 ==========
  // document_start 时 body 尚不存在 → 挂到 documentElement(fixed 定位不受影响,且不会被 React 触碰)。
  // 幂等:已注入则直接返回(SPA 路由切换会重复进 init)。
  function injectChrome() {
    if (document.getElementById(CHROME_ID)) return;
    var el = document.createElement('div');
    el.id = CHROME_ID;
    el.innerHTML = CHROME_HTML;
    (document.body || document.documentElement).appendChild(el);

    // 侧栏/状态栏外壳与顶栏同帧注入,避免"先有顶栏后有侧栏"的跳变
    var panels = document.createElement('div');
    panels.id = PANELS_ID;
    panels.innerHTML = PANELS_HTML;
    (document.body || document.documentElement).appendChild(panels);
  }

  // 退出伪装时整体移除外壳,恢复知乎原生视觉
  function removeChrome() {
    var el = document.getElementById(CHROME_ID);
    if (el) el.remove();
    var panels = document.getElementById(PANELS_ID);
    if (panels) panels.remove();
  }

  // ========== 左侧导航树 ==========
  // _tocItems: 导航项数组 { level: 缩进层级 0-3, text: 显示文本, el: 页内锚点元素 }
  // _tocView:  当前 tab 视图 —— toc=层级树 / chapter=平铺编号 / bookmark=取前 3 条当书签
  // _tocSig:   上次采集内容的签名;签名不变则跳过重渲染
  //            (MutationObserver 触发频繁,去重可防导航闪烁与无谓开销)
  var _tocItems = [];
  var _tocView = 'toc';
  var _tocSig = '';

  // 压缩空白:知乎标题/作者名常带换行与连续空格,直接进导航会撑破单行样式
  function normText(s) {
    return (s || '').trim().replace(/\s+/g, ' ');
  }

  // 采集导航项:
  // - question/answer 页 → "回答者导航"(【问题】+ 每个回答的作者·赞同数,回答内 h2-h4 作子项),
  //   解决"当前在看谁 + 快速切换";
  // - 其余详情页 → 正文标题目录(h1-h4 按标签定层级)
  function collectToc() {
    var items = [];
    var pt = pageType();

    // 问题/回答页:回答者导航(知道当前在看谁 + 快速切换),回答内标题作子项
    if (pt === 'question' || pt === 'answer') {
      var q = document.querySelector('.QuestionHeader-title');
      if (normText(q && q.textContent)) {
        items.push({ level: 0, text: '【问题】' + normText(q.textContent), el: q });
      }
      var ans = document.querySelectorAll('[class~="AnswerItem"]');
      for (var a = 0; a < ans.length; a++) {
        var el = ans[a];
        var nameEl = el.querySelector('.AuthorInfo-name');
        var name = normText(nameEl && nameEl.textContent) || '匿名用户';
        var voteMeta = el.querySelector('meta[itemprop="upvoteCount"]');
        var votes = voteMeta ? voteMeta.getAttribute('content') : '';
        items.push({
          level: 0,
          text: name + (votes ? ' · ' + votes + ' 赞同' : ''),
          el: el
        });
        var hs = el.querySelectorAll('.RichText h2, .RichText h3, .RichText h4');
        for (var h = 0; h < hs.length; h++) {
          var ht = normText(hs[h].textContent);
          if (!ht) continue;
          items.push({
            level: Math.min(parseInt(hs[h].tagName.charAt(1), 10) - 1, 3),
            text: ht,
            el: hs[h]
          });
        }
      }
      return items;
    }

    // 其余详情页:正文标题目录
    var all = document.querySelectorAll(
      '.RichText h1, .RichText h2, .RichText h3, .RichText h4, ' +
      '.Post-RichText h1, .Post-RichText h2, .Post-RichText h3, ' +
      '.QuestionRichText h2, .QuestionRichText h3'
    );
    for (var i = 0; i < all.length; i++) {
      var text = normText(all[i].textContent);
      if (!text) continue;
      items.push({
        level: Math.min(parseInt(all[i].tagName.charAt(1), 10) - 1, 3),
        text: text,
        el: all[i]
      });
    }
    return items;
  }

  // 按当前视图渲染导航主体;data-i 为 _tocItems 下标,供点击跳转与滚动高亮反查
  function renderToc() {
    var body = document.getElementById('tdoc-toc-body');
    if (!body) return;
    // 暂无内容(正文未渲染)时显示骨架占位,看起来像"目录加载中",比空白更真实
    if (!_tocItems.length) {
      body.innerHTML = '<div class="tdoc-toc-skel"><i></i><i></i><i></i><i></i><i></i><i></i></div>';
      return;
    }
    var html = '';
    for (var i = 0; i < _tocItems.length; i++) {
      var it = _tocItems[i];
      if (_tocView === 'chapter') {
        html += '<div class="tdoc-toc-item lv0" data-i="' + i + '">' + (i + 1) + '. ' + esc(it.text) + '</div>';
      } else if (_tocView === 'bookmark') {
        if (i > 2) break;
        html += '<div class="tdoc-toc-item lv0" data-i="' + i + '">🔖 书签' + (i + 1) + ' · ' + esc(it.text) + '</div>';
      } else {
        html += '<div class="tdoc-toc-item lv' + it.level + '" data-i="' + i + '">' + esc(it.text) + '</div>';
      }
    }
    body.innerHTML = html;
  }

  // 转义标题文本,防止知乎内容里的 < > & 破坏导航 DOM(兼 XSS 防护)
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 重新采集并渲染;签名去重,内容没变就什么都不做
  function updateToc() {
    var items = collectToc();
    var sig = items.map(function (it) { return it.level + ':' + it.text; }).join('|');
    if (sig === _tocSig) return;
    _tocSig = sig;
    _tocItems = items;
    renderToc();
  }

  // 滚动时高亮"当前在读"项:最后一个顶部越过 180px(顶栏 131px + 容差)的锚点
  // 问题页即"当前在看谁的回答",配合点击实现快速切换
  function highlightToc() {
    if (!_tocItems.length || _tocView !== 'toc') return;
    var body = document.getElementById('tdoc-toc-body');
    if (!body) return;
    var activeIdx = 0;
    for (var i = 0; i < _tocItems.length; i++) {
      if (_tocItems[i].el.getBoundingClientRect().top < 180) activeIdx = i;
    }
    var nodes = body.querySelectorAll('.tdoc-toc-item');
    for (var n = 0; n < nodes.length; n++) {
      nodes[n].classList.toggle('active', parseInt(nodes[n].getAttribute('data-i'), 10) === activeIdx);
    }
  }

  // ========== 正文图片/视频交互(与 content.css 配合) ==========
  // CSS 侧:图片/视频默认显示【图片 N】/【视频 N】占位符,悬停预览原内容;
  // JS 侧补"点击固定":点外壳自身(占位区)切换 tdoc-img-pin,供触屏/需要持续看图看视频的场景;
  // 点原图 IMG / 视频播放器内部 / 链接 / lightbox 一律放行,保持知乎原生行为不被拦截。
  function setupImagePin() {
    document.addEventListener('click', function (e) {
      if (!state.disguised) return;
      var t = e.target;
      if (!t || !t.closest || t.tagName === 'IMG') return; // 原图/lightbox/链接不拦截
      // 视频外壳:点空白处(含占位条)固定/取消;播放器内部点击放行(visibility 恢复后控件可点)
      var vbox = t.closest('.tdoc-vidbox');
      if (vbox) {
        if (t === vbox) vbox.classList.toggle('tdoc-img-pin');
        return;
      }
      var fig = (t.closest && t.closest('.RichText figure, .QuestionRichText figure, .Post-RichText figure'));
      if (fig && t === fig) fig.classList.toggle('tdoc-img-pin');
    });
  }

  // ========== 底部状态栏:字数 / 页数 ==========
  // 字数 = 所有正文富文本去空白字符累加(问题页含全部已加载回答);
  // 正文尚未渲染时退化为整页 innerText,保证状态栏不显示 0。
  // 总页数按 800 字/页 估算,近似 A4 版心容量,纯装饰性数字。
  function updateStatus() {
    var wcEl = document.getElementById('tdoc-wordcount');
    if (!wcEl) return;
    var richs = document.querySelectorAll('.RichText, .QuestionRichText, .Post-RichText');
    var chars = 0;
    for (var i = 0; i < richs.length; i++) chars += (richs[i].innerText || '').replace(/\s/g, '').length;
    if (!chars && document.body) chars = (document.body.innerText || '').replace(/\s/g, '').length;
    wcEl.textContent = String(chars);
    var total = Math.max(1, Math.round(chars / 800));
    document.getElementById('tdoc-page-total').textContent = String(total);
    updatePageCur(total);
  }

  // 当前页码 = 滚动进度 × 总页数,夹在 [1, total];模拟 Word/WPS 的"页面 x/y"
  function updatePageCur(total) {
    var curEl = document.getElementById('tdoc-page-cur');
    if (!curEl) return;
    if (!total) total = parseInt(document.getElementById('tdoc-page-total').textContent, 10) || 1;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var ratio = max > 0 ? (window.scrollY || doc.scrollTop) / max : 1;
    var cur = Math.max(1, Math.min(total, Math.ceil(ratio * total)));
    curEl.textContent = String(cur);
  }

  // rAF 节流:每帧最多刷一次页码+导航高亮;passive 保证不阻塞知乎原生滚动
  var _scrollRaf = false;
  function setupScrollListener() {
    window.addEventListener('scroll', function () {
      if (_scrollRaf || !state.disguised) return;
      _scrollRaf = true;
      requestAnimationFrame(function () {
        _scrollRaf = false;
        updatePageCur(0);
        highlightToc();
      });
    }, { passive: true });
  }

  // 侧栏交互(事件委托,全文档只挂一次):
  // 1) 点 [data-tab] → 切换 toc/chapter/bookmark 视图;
  // 2) 点导航项 → 平滑滚动到对应锚点。
  // 用委托而非逐项绑定:导航主体会被 renderToc 反复重绘,逐项绑定会失效。
  function setupPanelEvents() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var tab = t.closest('[data-tab]');
      // 仅处理自己面板内的 data-tab:data-tab 是通用属性名,知乎元素也可能带,
      // 误处理会无谓翻转目录视图(不破坏知乎,但状态被脏写)
      var panels = document.getElementById(PANELS_ID);
      if (tab && panels && panels.contains(tab)) {
        _tocView = tab.getAttribute('data-tab');
        var tabs = tab.parentElement.querySelectorAll('[data-tab]');
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i] === tab);
        renderToc();
        return;
      }
      // tdoc-toc-item 为自有前缀 class,无碰撞风险,不必限定范围
      var item = t.closest('.tdoc-toc-item');
      if (item) {
        var idx = parseInt(item.getAttribute('data-i'), 10);
        if (_tocItems[idx]) _tocItems[idx].el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // ========== 评论入口标记(配合 html.tdoc-comments-on,v0.8) ==========
  // 知乎评论按钮没有稳定语义类名(混在通用 ContentItem-action 里),纯 CSS 无法单独选中;
  // 这里只给文本含「评论」的按钮打 .tdoc-comment-btn、给它在操作栏中的直接子级容器打
  // .tdoc-comment-slot,CSS 据此放行并重样式化为"批注入口"。
  // 不绑事件、不改文本、不拦截交互;React 重渲染掉 class 后由防抖观察器自动补打。
  function tagCommentButtons() {
    if (!state.disguised || !cfg.comments) return;
    // 卡片操作栏(首页/问答页回答)+ 文章页底部操作栏
    var bars = document.querySelectorAll('.ContentItem-actions, .Post-Sub');
    for (var i = 0; i < bars.length; i++) {
      var bar = bars[i];
      var btns = bar.querySelectorAll('button');
      for (var j = 0; j < btns.length; j++) {
        var btn = btns[j];
        if ((btn.textContent || '').indexOf('评论') === -1) continue;
        btn.classList.add('tdoc-comment-btn');
        // slot = 按钮所在的 bar 直接子级:CSS 隐藏 bar 全部直接子级、只放行 slot 与按钮
        var slot = btn;
        while (slot.parentElement && slot.parentElement !== bar) slot = slot.parentElement;
        if (slot !== btn) slot.classList.add('tdoc-comment-slot');
      }
    }
  }

  // ========== 视频外壳标记(配合 .tdoc-vidbox 占位样式,v0.8) ==========
  // 知乎视频外壳类名(VideoCard/Player/figure…)随发版变化,纯 CSS 猜不稳;
  // 这里以 <video> 元素为锚点,向上找最近外壳打 .tdoc-vidbox:
  // VideoCard 壳优先 → 否则 figure → 否则直接父级。CSS 据此隐藏播放器并显示占位符。
  // 只加 class 不改结构(不包 wrapper,避免干扰 React 协调);重渲染掉标后由防抖观察器补打。
  function tagVideoBoxes() {
    if (!state.disguised) return;
    var vids = document.querySelectorAll(
      '.RichText video, .QuestionRichText video, .Post-RichText video, [class*="VideoAnswer"] video'
    );
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      var box = v.closest('[class*="VideoCard"]') || v.closest('figure') || v.parentElement;
      if (box) box.classList.add('tdoc-vidbox');
    }
  }

  // ========== 文件名(顶栏中央 & tab 标题同源) ==========
  // 详情页 = 标题(个人主页取人名) + ".docx" 后缀,强化"这是一份文档"的认知;
  // 列表页 = "最近文档"。超 28 字截断防顶栏溢出。
  // 标题兜底用 _origTitle(知乎真实标题)而非 document.title —— 伪装态下后者已是假标题。
  function chromeFileName() {
    if (isDetailPage()) {
      // 个人主页取人名,其余详情页取内容标题
      var tEl = (pageType() === 'profile')
        ? document.querySelector('.ProfileHeader-name')
        : document.querySelector('.Post-Title, .ContentItem-title, .QuestionHeader-title, h1');
      var title = tEl ? normText(tEl.textContent) : '';
      if (!title) title = (_origTitle || document.title || '').replace(/\s*[-|]\s*知乎\s*$/, '').trim();
      if (!title) title = '文档';
      if (title.length > 28) title = title.slice(0, 28) + '…';
      return title + '.docx';
    }
    return '最近文档';
  }

  function updateChromeFilename() {
    var el = document.getElementById('tdoc-filename');
    if (el) {
      var text = chromeFileName();
      if (el.textContent !== text) el.textContent = text;
    }
    // 顶栏文件名与 tab 标题同源,内容标题异步渲染完成后一并刷新
    enforceTabIdentity();
  }

  // ========== Tab 身份伪装(标题 + favicon,v0.8) ==========
  // 只改页面内容时最大的穿帮点:tab 仍是知乎标题 + 蓝色图标,历史记录同样留痕。
  // - title:伪装态改写为"{文件名} - 腾讯文档"(Chrome 历史记录条目随 document.title 同步更新);
  //   知乎 SPA 会自行改写 title,由常驻 MutationObserver 在微任务级抓回,无"闪回知乎"
  // - favicon:移除知乎全部 icon <link>(保留节点引用,退出伪装原样放回),注入内联 data URI 图标
  var _origTitle = '';    // 知乎真实标题(退出伪装还原用 & 文件名兜底)
  var _savedIcons = [];   // 被移除的知乎 favicon <link> 节点
  var _idObs = null;
  var _idHeadBound = false; // 观察范围是否已收窄到 head

  // tab 标题 = 顶栏文件名 + 品牌后缀
  function tabTitle() {
    return chromeFileName() + ' - 腾讯文档';
  }

  function enforceTabIdentity() {
    if (!state.disguised) return;
    // 标题:直接改写知乎已有的 <title> 元素,而不是 document.title= ——
    // 后者在 <title> 尚未被解析时会抢先创建节点,与知乎随后插入的 <title> 形成双节点,
    // getter 永远命中先创建的假标题,导致真实标题捕获不到、退出伪装还原不了。
    var titleEl = document.querySelector('title');
    if (titleEl) {
      var want = tabTitle();
      var cur = titleEl.textContent || '';
      if (cur !== want) {
        if (cur) _origTitle = cur; // 覆盖前先记下知乎真实标题(SPA 切页时持续更新)
        titleEl.textContent = want;
      }
    }
    // 收走知乎图标(含 SPA 动态新加的);移除会再触发 observer,但下一轮已无外来节点,天然收敛
    var links = document.querySelectorAll('link[rel~="icon"]');
    for (var i = 0; i < links.length; i++) {
      if (links[i].id === FAVICON_ID) continue;
      _savedIcons.push(links[i]);
      links[i].remove();
    }
    if (!document.getElementById(FAVICON_ID) && document.head) {
      var link = document.createElement('link');
      link.id = FAVICON_ID;
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = DOC_FAVICON;
      document.head.appendChild(link);
    }
  }

  function restoreTabIdentity() {
    var mine = document.getElementById(FAVICON_ID);
    if (mine) mine.remove();
    for (var i = 0; i < _savedIcons.length; i++) {
      if (!_savedIcons[i].isConnected && document.head) document.head.appendChild(_savedIcons[i]);
    }
    _savedIcons = [];
    // _origTitle 为空(知乎 <title> 从未被解析到就退出,极端时序)时兜底还原为"知乎":
    // 若不处理,假标题会残留在 tab 上,且常驻观察会把假标题反向记录成"真实标题"
    document.title = _origTitle || '知乎';
  }

  // 常驻观察(与伪装开关无关):
  // - 伪装态:知乎改 title/favicon → 微任务级改回
  // - 非伪装态:持续记录真实标题,供之后还原/兜底
  // 监听范围:head 出现前粗挂 documentElement,head 一出现立即收窄换绑 ——
  // 避免非伪装态持续接收 React 全页渲染的 mutation 噪音("不伪装 → 零开销"承诺)
  function startIdentityWatch() {
    if (_idObs) return;
    var HEAD_OPTS = { childList: true, subtree: true, characterData: true };
    _idObs = new MutationObserver(function () {
      if (!_idHeadBound && document.head) {
        _idObs.unobserve(document.documentElement);
        _idObs.observe(document.head, HEAD_OPTS);
        _idHeadBound = true;
      }
      if (state.disguised) { enforceTabIdentity(); return; }
      var t = document.title;
      if (t && t !== _origTitle) _origTitle = t;
    });
    if (document.head) {
      _idObs.observe(document.head, HEAD_OPTS);
      _idHeadBound = true;
    } else {
      _idObs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  // 知乎内容是异步渲染(SPA/懒加载/无限滚动),注入瞬间标题与正文可能还不存在;
  // 用全局 MutationObserver + 300ms 防抖兜底:DOM 一变就统一刷新 文件名/导航/字数。
  var _fnObserver = null;
  var _fnTimer = null;
  function startFilenameWatch() {
    if (_fnObserver) return;
    _fnObserver = new MutationObserver(function () {
      if (_fnTimer) return;
      _fnTimer = setTimeout(function () {
        _fnTimer = null;
        if (state.disguised) {
          updateChromeFilename();
          updateToc();
          updateStatus();
          tagCommentButtons(); // React 重渲染会冲掉标记,随防抖统一补打
          tagVideoBoxes();
        }
      }, 300);
    });
    _fnObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  // 退出伪装时断开观察,省掉无谓的 DOM 监听开销
  function stopFilenameWatch() {
    if (_fnObserver) { _fnObserver.disconnect(); _fnObserver = null; }
    if (_fnTimer) { clearTimeout(_fnTimer); _fnTimer = null; }
  }

  // ========== 状态广播 ==========
  // 通知 background 即时刷新工具栏图标的 hover title("阅读中/已关闭");
  // try/catch 兜底:扩展刚更新等场景下 chrome.runtime 可能暂不可用。
  function notifyState() {
    try {
      chrome.runtime.sendMessage({ type: 'STATE_CHANGED', disguised: state.disguised });
    } catch (e) {}
  }

  // ========== 核心:切换伪装 ==========
  // 换 body 模式 class:先移除全部五种模式 class 再加当前一种,防止跨模式样式残留
  function applyModeClass() {
    var html = document.documentElement;
    html.classList.remove.apply(html.classList, MODE_CLASSES);
    html.classList.add(modeClassFor(pageType()));
  }

  // 进入伪装,顺序有意义:
  // 加 class(内容立即换文档样式)→ 注入外壳 → 接管 tab 身份 → 刷新文件名/导航/状态
  // → 开 DOM 监听 → 持久化 → 广播。class 与外壳同帧完成,用户看不到"半伪装"中间态。
  // 注意:show/hide 不写 localStorage —— LS 语义是"用户显式持久化偏好",
  // 只由 toggleDisguise 写入;策略自动开合若也写 LS,会污染 manual 模式的开关状态
  function showDisguise() {
    state.disguised = true;
    document.documentElement.classList.add('tdoc-disguised');
    applyModeClass();
    injectChrome();
    enforceTabIdentity(); // 先于文件名刷新:捕获知乎真实标题供兜底
    updateChromeFilename();
    updateToc();
    updateStatus();
    tagCommentButtons(); // 评论区开启时补打入口标记(关闭态内部直接 return)
    tagVideoBoxes();     // 视频外壳标记(供 .tdoc-vidbox 占位样式)
    startFilenameWatch();
    notifyState();
  }

  // 退出伪装:showDisguise 的逆操作,并停掉 DOM 监听、移除外壳、还原 tab 身份
  function hideDisguise() {
    state.disguised = false;
    var html = document.documentElement;
    html.classList.remove('tdoc-disguised');
    html.classList.remove.apply(html.classList, MODE_CLASSES);
    removeChrome();
    restoreTabIdentity();
    stopFilenameWatch();
    notifyState();
  }

  function toggleDisguise() {
    // 手动动作代表用户当下意图,本会话内优先于策略自动逻辑(路由切换不覆盖)
    if (state.disguised) { sessionOverride = false; hideDisguise(); }
    else { sessionOverride = true; showDisguise(); }
    savePrefs(); // 仅显式切换持久化偏好(热键/FAB/popup 三入口都走这里)
  }

  // ========== FAB 悬浮按钮 ==========
  // 右下角常驻切换入口(不依赖顶栏,伪装关闭后也能一键开回);
  // 伪装态默认隐匿(CSS opacity:0,hover 浮现 20%)——腾讯文档里没有这个按钮,常显反而是破绽;
  // 可在 popup 打开 tdoc-fab-on(html class)恢复常显。需 body 就绪;已存在则跳过(SPA 会重复进 init)。
  function ensureFAB() {
    if (!document.body || document.getElementById(FAB_ID)) return;
    var fab = document.createElement('button');
    fab.id = FAB_ID;
    fab.title = '知乎摸鱼助手:点击切换伪装(伪装态下悬停右下角可找到我)';
    fab.textContent = '📄';
    fab.addEventListener('click', toggleDisguise);
    document.body.appendChild(fab);
  }

  // ========== 配置加载(chrome.storage.sync 跨设备同步 + onChanged 热更新) ==========
  // 除策略外的配置都只在交互时用到,异步加载足够;策略额外走 LS 镜像保证首帧同步读。
  var _lastSpaceTs = 0; // 上一次按空格的时间戳,dbl-space 方案的双击判定依据

  function readConfigInto(r) {
    var prevStrategy = cfg.strategy;
    if (typeof r[HOTKEY_KEY] === 'string') cfg.hotkey = validHotkey(r[HOTKEY_KEY]);
    cfg.strategy = validStrategy(typeof r[STRATEGY_KEY] === 'string' ? r[STRATEGY_KEY] : cfg.strategy);
    cfg.panicKey = validPanicKey(typeof r[PANIC_KEY] === 'string' ? r[PANIC_KEY] : cfg.panicKey);
    cfg.panicMode = validPanicMode(typeof r[PANIC_MODE_KEY] === 'string' ? r[PANIC_MODE_KEY] : cfg.panicMode);
    if (typeof r[PANIC_URL_KEY] === 'string') cfg.panicUrl = r[PANIC_URL_KEY];
    // onChanged 是局部变更:未出现在 r 里的键必须保持现值,不能被默认值冲掉
    if (r[FAB_VIS_KEY] !== undefined) cfg.fabVisible = r[FAB_VIS_KEY] === '1' || r[FAB_VIS_KEY] === true;
    if (r[COMMENTS_KEY] !== undefined) cfg.comments = r[COMMENTS_KEY] === '1' || r[COMMENTS_KEY] === true;
    mirrorStrategy();
    applyConfig(prevStrategy);
  }

  function loadConfig() {
    try {
      chrome.storage.sync.get([HOTKEY_KEY, STRATEGY_KEY, PANIC_KEY, PANIC_MODE_KEY, PANIC_URL_KEY, FAB_VIS_KEY, COMMENTS_KEY], function (r) {
        if (r) readConfigInto(r);
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync' || !changes) return;
        var flat = {};
        for (var k in changes) if (changes.hasOwnProperty(k)) flat[k] = changes[k].newValue;
        readConfigInto(flat);
      });
    } catch (e) {}
  }

  // 配置落地:FAB 显隐 class、评论区显隐 class、老板键停用收层、策略变更即时按新策略重判当前页
  function applyConfig(prevStrategy) {
    document.documentElement.classList.toggle('tdoc-fab-on', !!cfg.fabVisible);
    document.documentElement.classList.toggle('tdoc-comments-on', !!cfg.comments);
    // 评论区刚打开:立即补打入口标记(观察器要等下一次 DOM 变化才会跑)
    if (cfg.comments) tagCommentButtons();
    if (cfg.panicKey === 'off' && state.panic) hidePanic();
    if (prevStrategy !== undefined && prevStrategy !== cfg.strategy) {
      // 策略变了:清手动干预、破路由去重,立即重判(可能 show 也可能 hide)
      sessionOverride = null;
      state.lastUrl = '';
      handleRouteChange();
    }
  }

  // 输入场景不触发,保证知乎评论/回答/搜索输入不受干扰
  function isEditable(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
    return !!el.isContentEditable;
  }

  // 捕获阶段(true)监听,先于知乎自身按键处理拿到事件,保证 preventDefault 有效
  function setupHotkey() {
    document.addEventListener('keydown', function (e) {
      // 老板键覆盖层生效期间禁用伪装切换:用户看不见页面,避免"隐形切换"造成恢复后状态意外
      if (state.panic) return;
      // off=关闭快捷键;长按重复键不算;输入框/富文本编辑中不算(见 isEditable)
      if (cfg.hotkey === 'off' || e.repeat || isEditable(e.target)) return;

      if (cfg.hotkey === 'alt-q') {
        // Alt+Q(Chrome 无内置占用;不用 Ctrl+Shift+D,那是浏览器"加入书签"保留键,页面拦不住)
        if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q')) {
          e.preventDefault();
          toggleDisguise();
        }
        return;
      }
      if (cfg.hotkey === 'ctrl-alt-d') {
        // Ctrl+Alt+D 无浏览器/系统级保留冲突,可安全 preventDefault
        if (e.ctrlKey && e.altKey && !e.metaKey && (e.code === 'KeyD' || e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          toggleDisguise();
        }
        return;
      }
      // dbl-space(默认):300ms 内连按两次空格视为快捷键;
      // 第二击 preventDefault,避免触发一次多余的页面滚动;
      if (e.code === 'Space' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        var now = Date.now();
        if (now - _lastSpaceTs < 300) {
          e.preventDefault();
          _lastSpaceTs = 0;
          toggleDisguise();
        } else {
          _lastSpaceTs = now;
        }
      } else {
        // 中途按了别的键就清零,防"空格→别的键→空格"误触发
        _lastSpaceTs = 0;
      }
    }, true);
  }

  // ========== 老板键(应急模式,v0.8) ==========
  // 与伪装开关正交:双击 Esc 立即全屏盖上"无害画面"(假终端构建日志 / 假 Excel 报表),
  // 或跳转预置工作页;再次双击 Esc 恢复,伪装状态与滚动位置保持触发前不变。
  // 输入框内也触发(应急不问上下文);覆盖期间吞掉滚动类按键,保证恢复后页面纹丝不动。
  var _lastEscTs = 0;
  var _termTimer = null;
  var _termIdx = 0;
  var _savedOverflow = null;
  var _panicFs = false; // 本次覆盖层是否由我们进入的全屏(恢复时只退出自己进的)

  // 假终端日志池:webpack/npm 风格构建输出,循环追加营造"正在跑 CI"的观感;
  // {TS} 占位符渲染为实时时间戳,强化"活的"错觉
  var TERM_LINES = [
    '$ npm run build',
    '> client@2.4.1 build',
    '> webpack --config webpack.prod.js --mode production',
    '',
    'assets by status 2.14 MiB [emitted]',
    '  asset static/js/app.3f2a1c9b.js 842 KiB [emitted] [minimized] (name: app)',
    '  asset static/js/vendor.9b7e2d41.js 514 KiB [emitted] [minimized] (name: vendor)',
    '  asset static/css/main.a8c31f02.css 68.4 KiB [emitted] (name: app)',
    '  asset index.html 2.31 KiB [emitted]',
    'orphan modules 214 KiB [orphan] 128 modules',
    'runtime modules 8.21 KiB 14 modules',
    '{TS} INFO  Building production bundle...',
    '{TS} INFO  Copying public assets to dist/...',
    'built modules 1.86 MiB [building] 412 modules',
    'webpack compiled successfully in 24817 ms',
    '{TS} ✓ Compiled successfully',
    '{TS} ⚠ 3 warnings compiled (bundle size, a11y)',
    'Browserslist: caniuse-lite is up to date',
    '',
    '$ npm run lint',
    '> eslint src --ext .js,.ts,.tsx',
    '{TS} ✓ 412 problems (0 errors, 0 warnings)',
    '',
    '$ npm run test:unit -- --coverage',
    'PASS src/utils/format.test.ts',
    'PASS src/hooks/useAuth.test.tsx',
    'PASS src/components/DataTable.test.tsx',
    'Test Suites: 38 passed, 38 total',
    'Tests:       517 passed, 517 total',
    'Snapshots:   42 passed, 42 total',
    'Time:        18.442 s',
    '{TS} DONE  Build complete. The dist directory is ready to be deployed.',
    '{TS} INFO  Uploading sourcemaps...',
    '{TS} INFO  Generating service worker...',
    '{TS} ✓ Service worker generated at /sw.js',
    ''
  ];

  function termStamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return '[' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ']';
  }

  function termFill(s) {
    return s.indexOf('{TS}') !== -1 ? s.replace('{TS}', termStamp()) : s;
  }

  // 行着色:成功绿 / 警告黄 / 命令行亮白,其余默认灰(纯 class,内容全静态无 XSS 面)
  // 带 {TS} 前缀的行先剥掉占位符再判类型
  function termLineClass(s) {
    var t = s.indexOf('{TS} ') === 0 ? s.slice(5) : s;
    if (/^(✓|DONE|PASS|webpack .*successfully|Tests:|Test Suites:|Snapshots:)/.test(t)) return ' ok';
    if (/^(⚠|WARN)/.test(t)) return ' warn';
    if (/^\$/.test(t)) return ' cmd';
    return '';
  }

  function termHTML() {
    var html = '';
    var n = Math.min(TERM_LINES.length, 28);
    for (var i = 0; i < n; i++) {
      html += '<div class="tp-line' + termLineClass(TERM_LINES[i]) + '">' + esc(termFill(TERM_LINES[i])) + '</div>';
    }
    html += '<div class="tp-line"><span class="tp-cursor">█</span></div>';
    _termIdx = n;
    return html;
  }

  // 每 700ms 在光标行前追加一行,超上限移除最旧行;离开覆盖层立即停表
  function startTermLoop() {
    stopTermLoop();
    _termTimer = setInterval(function () {
      var body = document.getElementById('tp-term-body');
      if (!body) { stopTermLoop(); return; }
      var cursor = body.lastChild;
      var s = TERM_LINES[_termIdx % TERM_LINES.length];
      var div = document.createElement('div');
      div.className = 'tp-line' + termLineClass(s);
      div.textContent = termFill(s);
      body.insertBefore(div, cursor);
      while (body.childNodes.length > 300) body.removeChild(body.firstChild);
      body.scrollTop = body.scrollHeight;
      _termIdx++;
    }, 700);
  }
  function stopTermLoop() {
    if (_termTimer) { clearInterval(_termTimer); _termTimer = null; }
  }

  // 假表格:Excel 风"季度销售报表",数据全部由固定公式生成(确定性、无害、不依赖页面内容)
  function sheetHTML() {
    var cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    var heads = ['月份', '华东', '华北', '华南', '西南', '合计', '同比', '环比', '达成率', '备注'];
    var months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    var rows = [];
    var totals = [0, 0, 0, 0, 0];
    var prevSum = 0;
    for (var m = 0; m < 12; m++) {
      var v = [320 + ((m * 53) % 140), 280 + ((m * 41) % 120), 260 + ((m * 67) % 150), 180 + ((m * 29) % 90)];
      var sum = v[0] + v[1] + v[2] + v[3];
      var mom = prevSum ? (((sum - prevSum) / prevSum) * 100).toFixed(1) + '%' : '—';
      prevSum = sum;
      rows.push([months[m], v[0], v[1], v[2], v[3], sum, '+' + (8 + ((m * 7) % 15)) + '.' + ((m * 3) % 10) + '%', mom, (92 + ((m * 5) % 18)) + '.' + ((m * 7) % 10) + '%', '']);
      for (var c = 0; c < 5; c++) totals[c] += (c < 4 ? v[c] : sum);
    }
    var html = '';
    html += '<div class="tps-ribbon">' +
        '<span class="tps-logo">X</span>' +
        '<span class="tps-docname">季度销售报表.xlsx</span>' +
        '<span class="tps-save">已保存 ✓</span>' +
        '<div class="tps-menus"><i>文件</i><i class="on">开始</i><i>插入</i><i>页面布局</i><i>公式</i><i>数据</i><i>审阅</i><i>视图</i></div>' +
      '</div>';
    html += '<div class="tps-toolbar">' +
        '<b>Calibri</b><b>11</b><span class="sep"></span><b>B</b><i>I</i><u>U</u><span class="sep"></span>' +
        '<span>Σ 自动求和</span><span class="sep"></span><span>▦ 表格</span>' +
      '</div>';
    html += '<div class="tps-formula"><b>fx</b><span>=SUM(B2:F13)</span></div>';
    html += '<div class="tps-gridwrap"><table class="tps-grid"><tr><th class="corner"></th>';
    for (var i = 0; i < cols.length; i++) html += '<th>' + cols[i] + '</th>';
    html += '</tr>';
    // 第 1 行:表头(月份/华东/…),数据从第 2 行开始 —— 与公式栏 =SUM(B2:F13) 呼应
    html += '<tr class="headrow"><th>1</th>';
    for (var h = 0; h < heads.length; h++) html += '<td>' + heads[h] + '</td>';
    html += '</tr>';
    for (var r = 0; r < rows.length; r++) {
      html += '<tr><th>' + (r + 2) + '</th>';
      for (var j = 0; j < rows[r].length; j++) {
        // 首列左对齐;"合计"列浅底色;第 4 行合计单元格 = 选中态(绿色描边,呼应公式栏)
        var cls = j === 0 ? ' class="txt"' : (j === 5 ? (r === 3 ? ' class="sum sel"' : ' class="sum"') : '');
        html += '<td' + cls + '>' + rows[r][j] + '</td>';
      }
      html += '</tr>';
    }
    html += '<tr class="total"><th>14</th><td class="txt">总计</td>';
    for (var t = 0; t < 4; t++) html += '<td>' + totals[t] + '</td>';
    html += '<td>' + totals[4] + '</td><td>+11.6%</td><td>—</td><td>96.4%</td><td></td></tr>';
    for (var e = 15; e <= 30; e++) {
      html += '<tr><th>' + e + '</th>';
      for (var ec = 0; ec < cols.length; ec++) html += '<td></td>';
      html += '</tr>';
    }
    html += '</table></div>';
    html += '<div class="tps-status"><span class="tps-sheet-tab">Sheet1</span><span>就绪</span>' +
      '<span class="tps-right">平均值: 372 &nbsp;计数: 60 &nbsp;&nbsp;100%</span></div>';
    return html;
  }

  function togglePanic() {
    if (state.panic) hidePanic(); else showPanic();
  }

  function showPanic() {
    if (cfg.panicMode === 'redirect') {
      var url = (cfg.panicUrl || '').trim();
      // 仅放行 http(s) 绝对地址;未配置时静默降级为假终端,应急场景绝不"按了没反应"
      if (/^https?:\/\//i.test(url)) {
        state.panic = true;
        // 记下阅读现场:跳走后本页面 JS 全部卸载,返回入口由 popup 读这条记录提供;
        // 回到原地址时(init 里 PANIC_RETURNED)自动清除
        try { chrome.storage.local.set({ tdoc_panic_return: location.href }); } catch (e) {}
        location.href = url;
        return;
      }
    }
    if (document.getElementById(PANIC_ID)) return;
    var el = document.createElement('div');
    el.id = PANIC_ID;
    if (cfg.panicMode === 'sheet') {
      el.className = 'tp-sheet';
      el.innerHTML = sheetHTML();
    } else {
      el.className = 'tp-term';
      el.innerHTML =
        '<div class="tp-term-bar"><i></i><i></i><i></i>' +
        '<span>dev@build-server: ~/webapp — npm run build</span></div>' +
        '<div class="tp-term-body" id="tp-term-body">' + termHTML() + '</div>';
    }
    (document.body || document.documentElement).appendChild(el);
    state.panic = true;
    // 锁页面滚动:覆盖期间滚轮/按键都不动底下页面,恢复后滚动位置原样
    _savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    // 盖住浏览器自身 UI(tab 条/地址栏):keydown 算用户手势,可合法进全屏;
    // 用户在 fullscreen 下按 Esc 会被浏览器先行退出全屏 → fullscreenchange 里顺势收起覆盖层
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        _panicFs = true;
        var fsPromise = document.documentElement.requestFullscreen();
        if (fsPromise && fsPromise.catch) fsPromise.catch(function () { _panicFs = false; });
      } catch (e) { _panicFs = false; }
    }
    if (cfg.panicMode !== 'sheet') startTermLoop();
  }

  function hidePanic() {
    var el = document.getElementById(PANIC_ID);
    if (el) el.remove();
    stopTermLoop();
    state.panic = false;
    if (_panicFs && document.fullscreenElement) {
      try {
        var exit = document.exitFullscreen();
        if (exit && exit.catch) exit.catch(function () {});
      } catch (e) {}
    }
    _panicFs = false;
    if (_savedOverflow !== null) {
      // || '' 防御:异常环境下读到的旧值若非字符串,赋 undefined 会被 CSSOM 当非法值
      document.documentElement.style.overflow = _savedOverflow || '';
      _savedOverflow = null;
    }
  }

  // 老板键监听:注册在伪装快捷键之前(捕获阶段),双击 Esc 判定与 dbl-space 同构
  function setupPanicKey() {
    document.addEventListener('keydown', function (e) {
      // 覆盖层生效期间:吞掉会滚动页面的按键(Esc 除外),保证恢复后位置不变
      if (state.panic && e.key !== 'Escape') {
        var k = e.key;
        if (k === ' ' || k === 'Spacebar' || k === 'PageUp' || k === 'PageDown' ||
            k === 'Home' || k === 'End' || (k && k.indexOf('Arrow') === 0)) {
          e.preventDefault();
        }
        return;
      }
      if (cfg.panicKey !== 'dbl-esc' || e.repeat) return;
      if (e.key !== 'Escape' && e.code !== 'Escape') { _lastEscTs = 0; return; }
      var now = Date.now();
      if (now - _lastEscTs < 300) {
        // 第二击:preventDefault + stopPropagation,不再触发知乎原生 Esc(关弹层等)
        e.preventDefault();
        e.stopPropagation();
        _lastEscTs = 0;
        togglePanic();
      } else {
        _lastEscTs = now; // 第一击放行,保留原生 Esc 语义(如关闭 lightbox)
      }
    }, true);
  }

  // ========== SPA 路由监听 ==========
  // 知乎是 SPA:站内跳转不刷新页面,只走 history.pushState/replaceState + popstate。
  // monkey-patch 两个 history 方法,在 URL 变化的"同一 tick"拿到新地址 →
  // 模式 class 可 0 延迟切换,新内容不会以旧模式闪一帧。
  function setupRouteListener() {
    var origPush = history.pushState;
    var origReplace = history.replaceState;
    history.pushState = function () { var r = origPush.apply(this, arguments); handleRouteChange(); return r; };
    history.replaceState = function () { var r = origReplace.apply(this, arguments); handleRouteChange(); return r; };
    window.addEventListener('popstate', handleRouteChange);
  }

  // 路由变化处理:同 URL 去重(pushState 可能重复调用);
  // 该伪装 → 未开则开、已开则原地刷新模式与内容;不该伪装且正伪装 → 恢复知乎原生
  function handleRouteChange() {
    var url = location.pathname + location.search;
    if (url === state.lastUrl) return;
    state.lastUrl = url;

    if (shouldDisguise()) {
      if (!state.disguised) {
        showDisguise();
      } else {
        // 已伪装:同步换 mode class,新内容立即以正确模式渲染,无闪烁
        applyModeClass();
        updateChromeFilename();
        _tocSig = ''; // 强制重建目录
        updateToc();
        updateStatus();
        tagCommentButtons(); // 新页面的操作栏需要重新标记评论入口
        tagVideoBoxes();     // 新页面的视频外壳重新标记
      }
    } else if (state.disguised) {
      // 详情页 → feed 且开关为 off:恢复知乎原生浏览
      hideDisguise();
    }
  }

  // ========== Message 协议(与 popup / background 通信) ==========
  // GET_STATE       → popup 查询当前页状态(开关/模式/是否知乎域),用于弹窗 UI 回填
  // TOGGLE_DISGUISE → popup 远程切换开关
  // (background 转发过来的消息与 popup 直发走同一处理;content 主动外发的是 STATE_CHANGED)
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return;
      if (msg.type === 'GET_STATE') {
        var pt = pageType();
        sendResponse({
          disguised: state.disguised,
          panic: state.panic,
          pageType: pt, // v0.8:真实页面类型,popup 按此显示精确模式名
          strategy: cfg.strategy,
          mode: state.disguised ? (pt === 'article' || pt === 'question' || pt === 'answer' ? 'article' : 'list') : 'off', // 兼容旧字段
          onZhihu: /zhihu\.com$/.test(location.hostname)
        });
        return true;
      }
      if (msg.type === 'TOGGLE_DISGUISE') {
        toggleDisguise();
        sendResponse({ disguised: state.disguised });
        return true;
      }
    });
  }

  // ========== 调试工具(window.__tdoc) ==========
  // 用途:知乎发版导致选择器失效时,在真实页面 F12 跑 __tdoc.diag() 采集 DOM 结构,
  // 据此精准修 content.css 的选择器,而不靠猜。
  // semanticClasses: 过滤 css-xxxx 这类 emotion hash 类(每次发版都变,不可依赖),
  // 只保留语义类名;全是 hash 时取第一个并加 ~ 标记"不稳定"
  function semanticClasses(el) {
    if (!el || !el.className || typeof el.className !== 'string') return '';
    var all = el.className.split(/\s+/).filter(Boolean);
    var semantic = all.filter(function (c) { return c.indexOf('css-') === -1; });
    if (semantic.length) return semantic.join('.');
    if (all.length) return all[0] + '~'; // ~ 标记:不稳定的 hash 类名
    return '';
  }

  // 把节点压成一行描述:<tag class="语义类"> 文本片段,便于贴回聊天里分析
  function descNode(el, depth) {
    if (!el || el.nodeType !== 1) return null;
    var tag = el.tagName.toLowerCase();
    var cls = semanticClasses(el);
    var line = new Array(depth + 1).join('  ') + '<' + tag + (cls ? ' class="' + cls + '"' : '');
    var t = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    if (t && el.children.length === 0) line += '> ' + t;
    else if (t && depth < 2) line += '> "' + t.slice(0, 20) + '..."';
    line += '>';
    return line;
  }

  // 限深限宽的 DOM 树遍历输出,防止整页 dump 撑爆控制台
  function dumpTree(el, maxDepth, maxChildren, depth, out) {
    if (!el || depth > maxDepth) return;
    var line = descNode(el, depth);
    if (line) out.push(line);
    var kids = Array.prototype.slice.call(el.children).slice(0, maxChildren);
    for (var i = 0; i < kids.length; i++) {
      dumpTree(kids[i], maxDepth, maxChildren, depth + 1, out);
    }
  }

  // 诊断:输出页面真实结构 + 展开控件 + 疑似广告,用于精准修选择器
  function diag() {
    var out = [];
    out.push('===== 知乎摸鱼助手 诊断 =====');
    out.push('URL: ' + location.href);
    out.push('pageType: ' + pageType() + ' | html classes: ' + document.documentElement.className);
    out.push('');

    out.push('--- #root 顶层结构 (depth 3) ---');
    var root = document.getElementById('root') || document.body;
    var t = [];
    dumpTree(root, 3, 8, 0, t);
    out.push(t.slice(0, 80).join('\n'));
    out.push('');

    out.push('--- 展开/折叠控件 (Expand/ShowAll/ContentItem-more/RichContent-inner) ---');
    var exp = document.querySelectorAll('[class*="Expand"], [class*="ShowAll"], [class*="ContentItem-more"], [class*="RichContent-inner"]');
    for (var i = 0; i < exp.length && i < 15; i++) {
      var cs = getComputedStyle(exp[i]);
      out.push(descNode(exp[i], 0) + '  [display=' + cs.display + ' visible=' + (cs.visibility !== 'hidden' && cs.display !== 'none') + ']');
    }
    if (!exp.length) out.push('(无)');
    out.push('');

    out.push('--- 疑似广告元素 ---');
    var ads = document.querySelectorAll('[class*="advert" i], [class*="feedAd" i], [class*="Business-Card"], [class*="VipRecommend"], [class*="Pc-card"], [class*="Banner"], [class*="Intervene"], [class*="Reward"], [class*="Promotion"]');
    var shown = 0;
    for (var a = 0; a < ads.length && shown < 20; a++) {
      var st = getComputedStyle(ads[a]);
      if (st.display === 'none') continue; // 已被隐藏的不报
      out.push(descNode(ads[a], 0) + '  [仍在显示!]');
      shown++;
    }
    if (!shown) out.push('(无可见广告元素,或选择器未命中——请截图)');
    out.push('');

    out.push('--- 白色卡片候选 (背景为白的可见大块) ---');
    var all = document.querySelectorAll('div, section, article');
    var c = 0;
    for (var b = 0; b < all.length && c < 12; b++) {
      var el = all[b];
      if (el.offsetWidth < 500 || el.offsetHeight < 150) continue;
      var bg = getComputedStyle(el).backgroundColor;
      if (bg === 'rgb(255, 255, 255)') {
        out.push(descNode(el, 0) + '  [' + el.offsetWidth + 'x' + el.offsetHeight + ']');
        c++;
      }
    }
    out.push('');

    // 评论区结构:用于校准"批注样式"选择器(知乎评论类名随版本变化,以真实 dump 为准)
    out.push('--- 评论区结构 (Comments/CommentList/Post-Sub/操作栏, depth 3) ---');
    var cm = document.querySelectorAll('[class*="Comments"], [class*="CommentList"], .Post-Sub, .ContentItem-actions');
    if (!cm.length) out.push('(未找到评论相关节点——先在页面点开"评论"再跑一次)');
    var dumped = 0;
    for (var ci = 0; ci < cm.length && dumped < 6; ci++) {
      var ct = [];
      dumpTree(cm[ci], 3, 6, 0, ct);
      out.push(ct.slice(0, 40).join('\n'));
      out.push('');
      dumped++;
    }
    out.push('--- 疑似评论按钮 (文本含"评论") ---');
    var cbtns = document.querySelectorAll('.ContentItem-actions button, .Post-Sub button, [class*="QuestionButtonGroup"] button');
    var cbShown = 0;
    for (var cb = 0; cb < cbtns.length && cbShown < 10; cb++) {
      if ((cbtns[cb].textContent || '').indexOf('评论') === -1) continue;
      out.push(descNode(cbtns[cb], 0) + '  [已标记=' + cbtns[cb].classList.contains('tdoc-comment-btn') + ']');
      cbShown++;
    }
    if (!cbShown) out.push('(无)');
    out.push('');

    // 回复弹层为 body 末尾 portal,样式类名靠宽松匹配 —— 没猜中时靠这段 dump 校准
    out.push('--- 可见弹层 (Popup/Dialog portal;请先点开某条评论的"回复"再跑 diag) ---');
    var pops = document.querySelectorAll('[class*="Popup"], [class*="Dialog"]');
    var pShown = 0;
    for (var pi = 0; pi < pops.length && pShown < 8; pi++) {
      var ps = getComputedStyle(pops[pi]);
      if (ps.display === 'none' || ps.visibility === 'hidden') continue;
      out.push(descNode(pops[pi], 0) + '  [pos=' + ps.position + ' z=' + ps.zIndex + ' top=' + ps.top + ']');
      pShown++;
    }
    if (!pShown) out.push('(无可见弹层——点开"回复"后再跑一次)');

    var text = out.join('\n');
    console.log(text);
    return text;
  }

  // 控制台调试入口:__tdoc.toggle() / show() / hide() / panic() / pageType() / diag()
  //   / getState() / getConfig() / setStrategy(s)
  window.__tdoc = {
    toggle: toggleDisguise,
    show: showDisguise,
    hide: hideDisguise,
    panic: togglePanic,      // 老板键:开/关覆盖层
    panicHide: hidePanic,
    pageType: pageType,
    diag: diag,
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    getConfig: function () { return JSON.parse(JSON.stringify(cfg)); },
    setStrategy: function (s) { try { var p = {}; p[STRATEGY_KEY] = s; chrome.storage.sync.set(p); } catch (e) {} }
  };

  // ============================================================
  // Bootstrap 第一阶段:document_start 同步执行(首帧前)
  // 目标:浏览器第一次绘制时,页面已经是伪装后的样子(零频闪)
  // ============================================================
  // 记录初始 URL,作为后续 SPA 路由去重的基线
  state.lastUrl = location.pathname + location.search;

  // 策略先读 LS 镜像(源在 storage.sync,由 loadConfig 异步校正并回写镜像)
  cfg.strategy = loadStrategyMirror();

  // tab 身份观察先于伪装启动:知乎真实 <title> 一被解析器插入就要捕获(还原/兜底都靠它)
  startIdentityWatch();

  if (shouldDisguise()) {
    // 兜底 pre-style:即使 content.css 注入时序有偏差,首帧也是灰底而非知乎白底
    try {
      var pre = document.createElement('style');
      pre.setAttribute('data-tdoc', 'pre');
      pre.textContent = 'html.tdoc-disguised,html.tdoc-disguised body{background:#F0F0F0!important;}';
      (document.head || document.documentElement).appendChild(pre);
    } catch (e) {}

    // 立即进入伪装态:html class + 固定顶栏(fixed,不依赖 body)
    showDisguise();
  }
  // 不伪装 → 零注入,页面原生渲染

  // ============================================================
  // Bootstrap 第二阶段:body 就绪后补齐交互层
  // 路由/消息/快捷键/侧栏事件/滚动/图片固定/FAB 都依赖 body 或用户交互,放这里
  // ============================================================
  function init() {
    setupRouteListener();
    setupMessageListener();
    setupPanicKey(); // 注册在伪装快捷键之前:应急优先级最高
    setupHotkey();
    loadConfig();
    setupPanelEvents();
    setupScrollListener();
    setupImagePin();
    ensureFAB();
    // bfcache 兜底:redirect 模式"后退"回本页时,JS 状态被原样恢复(state.panic=true)
    // 但覆盖层 DOM 已不存在 → 滚动键吞噬规则会误伤;检测到状态与 DOM 不一致立即复位
    window.addEventListener('pageshow', function () {
      if (state.panic && !document.getElementById(PANIC_ID)) hidePanic();
    });
    // fullscreen 下首按 Esc 被浏览器用于退出全屏(不派发可拦截的 keydown),
    // 借 fullscreenchange 顺势收起覆盖层:用户视角"Esc 一下全恢复"
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && state.panic && _panicFs) hidePanic();
    });
    // redirect 应急后回到原阅读页:清掉 popup"返回"按钮依赖的记录
    try {
      chrome.storage.local.get('tdoc_panic_return', function (r) {
        try {
          if (r && r.tdoc_panic_return === location.href && chrome.storage.local.remove) {
            chrome.storage.local.remove('tdoc_panic_return');
          }
        } catch (e) {}
      });
    } catch (e) {}
    // document_start 与 DOMContentLoaded 之间 URL 可能已变(SPA 兜底)
    handleRouteChange();
    if (state.disguised) { updateToc(); updateStatus(); }
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
