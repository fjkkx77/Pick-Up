/* 多设备同步 · 云同步面板（sync-panel.js）  v1.0.0
   ─────────────────────────────────────────────────────────────
   日程卡片（rc.wbztl.xyz）那个「云同步」面板的通用版：
     说明 → 同步码（明文、可直接改）→ 随机生成一个 / 复制 → 状态 → 关闭同步 / 开启并同步 → 立即同步一次 / 关闭窗口
   外加标题下那一行「☁ 已同步 · 刚刚」（paintLine）。

   只管面板**里面**；面板怎么弹出 / 收起（底部弹窗、下拉关闭、遮罩）是宿主的事，通过 close() 回调交给宿主。
   ⚠️ 硬约束：**状态变化时只改文字，不重建 DOM**。2026-10-06「接着来」旧版每次状态变化整块 innerHTML 重画，
      异步加载的二维码回调排队，开启同步后叠出 3 个二维码；重建还会打断正在输入的同步码。自检里有这条。
   ⚠️ 这是**存档正本**，项目里的副本要和它逐字节一致（见 README「已部署副本」）。

   用法：
     container.innerHTML = SyncPanel.markup({ noun: '记录' });
     const panel = SyncPanel.bind(container, {
       client,                                   // SyncClient.create(...) 的返回值
       toast: msg => …,                          // 轻提示
       confirm: (title, text, okLabel, onOk) => …,   // 二次确认（关闭同步用）；不传就用 window.confirm
       close: () => …,                           // 「关闭窗口」
       onChange: () => …                         // 开启 / 关闭之后宿主要刷新的东西（入口上的「已开启」等）
     });
     打开面板前： panel.fill();                    // 把当前同步码填进框里、刷新状态
     下拉关闭前： panel.dirty()                    // 框里改了码还没点开启 → true，宿主可以先问一句 */
(function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let seq = 0;

  /** 面板内部的 HTML。noun 是「这个站的数据叫什么」（日程 / 记录 / 笔记……），出现在说明文字里 */
  function markup(opts) {
    const o = Object.assign({ title: '云同步', noun: '数据', placeholder: '例如 my-sync-2026' }, opts || {});
    const id = 'spCode' + (++seq);
    return '' +
      '<p class="sp-title" data-sp="title">' + esc(o.title) + '</p>' +
      '<p class="sp-desc">在两台设备上填<b>同一个同步码</b>，' + esc(o.noun) + '就会自动互通。<br>' +
      '同步码相当于密码，知道它的人就能看到并修改这些' + esc(o.noun) + '，别外传。</p>' +
      '<p class="sp-label"><label for="' + id + '">同步码（8~64 位字母 / 数字 / - / _）</label></p>' +
      '<input class="sp-code" data-sp="code" id="' + id + '" type="text" maxlength="64" placeholder="' + esc(o.placeholder) + '"' +
      ' autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done">' +
      '<div class="sp-chips">' +
        '<button type="button" class="sp-btn" data-sp="gen">随机生成一个</button>' +
        '<button type="button" class="sp-btn" data-sp="copy">复制</button>' +
      '</div>' +
      '<p class="sp-label">状态</p>' +
      '<p class="sp-state" data-sp="state" aria-live="polite">未开启</p>' +
      '<div class="sp-acts">' +
        '<button type="button" class="sp-btn" data-sp="off">关闭同步</button>' +
        '<button type="button" class="sp-btn pri" data-sp="on">开启并同步</button>' +
      '</div>' +
      '<div class="sp-acts">' +
        '<button type="button" class="sp-btn" data-sp="now">立即同步一次</button>' +
        '<button type="button" class="sp-btn" data-sp="close">关闭窗口</button>' +
      '</div>';
  }

  function bind(rootEl, opts) {
    const o = opts || {};
    const C = o.client, SC = root.SyncClient;
    if (!C) throw new Error('SyncPanel.bind 需要 client');
    const $ = k => rootEl.querySelector('[data-sp="' + k + '"]');
    const input = $('code'), stateEl = $('state');
    const toast = o.toast || (m => root.alert(m));
    const confirmBox = o.confirm || ((t, x, ok, fn) => { if (root.confirm(t + '\n' + x)) fn(); });
    const changed = () => { paint(); if (o.onChange) o.onChange(); };

    function paint() {
      let txt = SC.statusText(C), bad = SC.isBad(C);
      if (C.status.configured === false && C.status.state !== 'unsupported') {
        txt = location.protocol === 'file:' ? '现在是直接双击打开的本地文件，没有服务器，同步用不了'
                                            : '这个地址的服务器还没配好同步（缺存储）';
        bad = true;
      } else if (!C.active()) {
        txt = C.code ? '未开启（数据仍保留在本机）' : '未开启';
      }
      stateEl.textContent = txt;
      stateEl.classList.toggle('bad', bad);
    }

    function fill() {
      input.value = C.code || '';
      paint();
      if (location.protocol !== 'file:') C.probe();
    }

    $('gen').addEventListener('click', () => { input.value = SC.randomCode(); });
    $('copy').addEventListener('click', () => {
      const v = input.value.trim();
      if (!v) { toast('同步码是空的'); return; }
      const nc = root.navigator && navigator.clipboard;
      (nc && nc.writeText ? nc.writeText(v) : Promise.reject()).then(
        () => toast('同步码已复制'),
        () => { input.focus(); input.select(); toast('复制失败，请长按选中后手动复制'); });
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('on').click(); } });
    $('on').addEventListener('click', () => {
      const err = C.enable(input.value);
      if (err) { toast(err); input.focus(); return; }
      input.value = C.code;
      input.blur();
      changed();
    });
    $('off').addEventListener('click', () => {
      if (!C.active()) { paint(); return; }
      confirmBox('关闭同步？', '这台设备上的数据都还在，只是不再和别的设备互通。同步码会留在框里，以后点「开启并同步」就能接回来。', '关闭同步', () => {
        C.disable(); changed();
      });
    });
    $('now').addEventListener('click', () => {
      if (!C.active()) { toast('先点「开启并同步」'); return; }
      C.syncNow();
    });
    $('close').addEventListener('click', () => { if (o.close) o.close(); });

    C.onState(paint);
    return {
      fill, paint,
      dirty: () => !!input.value.trim() && input.value.trim() !== (C.code || ''),
      input
    };
  }

  /** 标题下那一行：没开同步就藏起来，出错标红（元素上加 .bad） */
  function paintLine(el, client) {
    const on = client.active();
    el.hidden = !on;
    if (!on) return;
    el.textContent = '☁ ' + root.SyncClient.statusText(client);
    el.classList.toggle('bad', root.SyncClient.isBad(client));
  }

  root.SyncPanel = { markup, bind, paintLine, VERSION };
})(typeof window !== 'undefined' ? window : globalThis);
