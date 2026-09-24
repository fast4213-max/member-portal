/*
 * app.js — 画面の土台（画面の切り替え・ログイン・上のバー・管理メニュー・ダイアログ）
 * 各画面は member.js（組合員）と admin.js（役員）が SCREENS に登録する。
 */
'use strict';

var S = {
  screen: 'login',
  loginTab: 'member',
  pw: '',
  showPw: false,
  dialog: null,      // ダイアログを作る関数（null なら閉じている）
  fresh: true        // 画面が切り替わった直後（スクロールを先頭に戻す）
};

var SCREENS = {};

function go(screen) {
  if (S.screen !== screen) S.fresh = true;
  S.screen = screen;
  render();
}

function openDialog(builder) { S.dialog = builder; render(); }
function closeDialog() { S.dialog = null; render(); }

/** 描き直しの前後で、入力中の欄（data-key 付き）のフォーカスとカーソル位置を保つ */
function saveFocus_() {
  var a = document.activeElement;
  if (!a || !a.getAttribute || !a.getAttribute('data-key')) return null;
  var f = { key: a.getAttribute('data-key') };
  try { f.start = a.selectionStart; f.end = a.selectionEnd; } catch (e) { /* 対応していない欄 */ }
  return f;
}

function restoreFocus_(f) {
  if (!f) return;
  var el = document.querySelector('[data-key="' + f.key.replace(/"/g, '') + '"]');
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch (e) { /* 対応していない欄 */ }
}

function render() {
  var root = document.getElementById('app');
  var old = root.querySelector('.scroll');
  var top = !S.fresh && old ? old.scrollTop : 0;
  var focus = S.fresh ? null : saveFocus_();
  S.fresh = false;
  root.textContent = '';

  if (S.screen === 'login') {
    root.appendChild(loginView());
  } else {
    var sc = SCREENS[S.screen];
    var admin = Api.role === 'officer';
    if (admin && isWide()) root.appendChild(sideNav());
    root.appendChild(h('div', { class: 'col' },
      topBar(sc),
      h('div', { class: 'scroll' }, sc.view()),
      sc.bar ? sc.bar() : null,
      admin && !isWide() ? tabBar() : null));
  }
  if (S.dialog) root.appendChild(h('div', { class: 'overlay' }, S.dialog()));

  var sc2 = root.querySelector('.scroll');
  if (sc2) sc2.scrollTop = top;
  restoreFocus_(focus);
}

/** 最初のエラー表示までスクロール */
function scrollToError() {
  requestAnimationFrame(function () {
    var el = document.querySelector('.er:not([hidden]), .note.red');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------- ログイン ----------

function loginView() {
  var admin = S.loginTab === 'officer';
  var tab = function (key, label) {
    return h('button', { type: 'button', role: 'tab', class: 'tab' + (S.loginTab === key ? ' on' : ''),
      'aria-selected': String(S.loginTab === key),
      onClick: function () { S.loginTab = key; S.pw = ''; render(); } }, label);
  };
  var submit = function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    if (!S.pw) { toast('パスワードを入力してください', 'err'); return; }
    withBusy(btn, Api.call('login', { role: S.loginTab, password: S.pw })).then(function (d) {
      Api.save(d.token, d.role, d.org);
      S.pw = '';
      S.showPw = false;
      if (d.role === 'officer') enterAdmin(); else enterMember();
    }, function (err) {
      S.pw = '';
      render();
      toast(err.message, 'err');
    });
  };
  return h('div', { class: 'login' },
    h('div', { class: 'login-hero' },
      h('div', { class: 'ring', style: 'right:-120px;top:-80px;width:340px;height:340px' }),
      h('div', { class: 'ring', style: 'right:-60px;top:-20px;width:220px;height:220px' }),
      h('div', { class: 'logo', style: 'width:48px;height:48px;border-radius:14px;color:#fff' }, ico('doc', 26)),
      h('div', { style: 'display:flex;flex-direction:column;gap:10px;position:relative' },
        h('h1', { class: 'login-title' }, '組合員台帳', h('br'), 'ポータル'),
        h('p', { style: 'margin:0;font-size:14px;line-height:1.7;color:#C3CDE6' }, '登録・変更の申請はここから。', h('br'), '役員の承認後に台帳へ反映されます。'))),
    h('form', { class: 'login-card', onSubmit: submit },
      h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'ログインの種類' }, tab('member', '共通'), tab('officer', '管理')),
      h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
        h('label', { for: 'pw', style: 'font-size:14px;font-weight:600' }, admin ? '管理用パスワード' : '共通パスワード'),
        h('div', { style: 'position:relative' },
          h('input', { id: 'pw', class: 'pw', type: S.showPw ? 'text' : 'password', value: S.pw, 'data-key': 'pw',
            autocomplete: 'current-password', placeholder: '••••••••',
            onInput: function (e) { S.pw = e.target.value; } }),
          h('button', { type: 'button', class: 'eye', 'aria-label': S.showPw ? 'パスワードを隠す' : 'パスワードを表示',
            onClick: function () { S.showPw = !S.showPw; render(); } }, ico('eye', 20))),
        h('p', { style: 'margin:0;font-size:13px;color:#5A6475' },
          admin ? '役員の方だけが使います。5回続けて間違えると15分ロックされます。' : '分会から案内されたパスワードを入力してください。')),
      h('button', { type: 'submit', class: 'btn ' + (admin ? 'navy' : 'pri') + ' full', style: 'height:52px;font-size:16px' },
        'ログイン', ico('arrow', 18)),
      h('div', { class: 'caution' }, ico('warn', 18, 'margin-top:1px'),
        h('span', null, '個人情報を含みます。画面の共有・スクリーンショットの取り扱いに注意してください。'))));
}

function logout() {
  if (S.screen !== 'login' && Api.token) Api.call('logout').catch(function () { /* 失敗しても画面上はログアウト */ });
  Api.save(null, null, null);
  resetMember();
  resetAdmin();
  S.dialog = null;
  go('login');
}

// ---------- 上のバー・管理メニュー ----------

function topBar(sc) {
  var back = sc.backFn ? sc.backFn() : sc.back;
  return h('div', { class: 'tb' },
    back ? h('button', { type: 'button', class: 'icb', 'aria-label': '戻る', onClick: back }, ico('back', 22))
            : h('div', { class: 'logo', style: 'margin:0 6px 0 8px;color:#fff' }, ico('doc', 20)),
    h('div', { class: 'tb-title' }, typeof sc.title === 'function' ? sc.title() : sc.title),
    sc.actions ? sc.actions() : null,
    h('button', { type: 'button', class: 'lo', onClick: logout }, 'ログアウト'));
}

var ADMIN_NAV = [
  ['a-list', '台帳一覧', 'list'], ['a-req', '承認待ち', 'approve'], ['a-log', '行動ログ', 'clock'], ['a-trash', 'ゴミ箱', 'trash']
];

function navActive_(key) {
  return S.screen === key ||
    (key === 'a-list' && (S.screen === 'a-ledger' || S.screen === 'a-edit' || (S.screen === 'confirm' && M.mode === 'edit')));
}

function sideNav() {
  return h('aside', { class: 'side' },
    h('div', { style: 'display:flex;align-items:center;gap:12px;padding:0 8px 28px' },
      h('div', { class: 'logo', style: 'width:38px;height:38px;color:#fff' }, ico('doc', 20)),
      h('div', { style: 'display:flex;flex-direction:column;gap:2px' },
        h('div', { class: 'h', style: 'font-weight:900;font-size:16px' }, '組合員台帳'),
        h('div', { style: 'font-size:11.5px;color:#9FB0D9' }, '管理コンソール'))),
    h('nav', { 'aria-label': '管理メニュー', style: 'display:flex;flex-direction:column;gap:4px' },
      ADMIN_NAV.map(function (n) {
        return h('button', { type: 'button', class: 'nav' + (navActive_(n[0]) ? ' on' : ''), onClick: function () { openAdmin(n[0]); } },
          ico(n[2], 18), n[1],
          n[0] === 'a-req' && A.pendingCount ? h('span', { class: 'bdg' }, A.pendingCount) : null,
          n[0] === 'a-trash' && A.trashCount ? h('span', { style: 'margin-left:auto;font-size:12px;color:#9FB0D9' }, A.trashCount) : null);
      })),
    h('div', { style: 'margin-top:auto;padding:12px;border-radius:12px;background:rgba(255,255,255,.06);font-size:12px;line-height:1.6;color:#C3CDE6' },
      '個人情報を含みます。画面の共有・スクリーンショットの取り扱いに注意してください。'));
}

function tabBar() {
  return h('nav', { class: 'tabbar', 'aria-label': '管理メニュー' },
    ADMIN_NAV.map(function (n) {
      return h('button', { type: 'button', class: 'tbb' + (navActive_(n[0]) ? ' on' : ''), onClick: function () { openAdmin(n[0]); } },
        ico(n[2], 22), n[1],
        n[0] === 'a-req' && A.pendingCount ? h('span', { class: 'bdg' }, A.pendingCount) : null);
    }));
}

// ---------- 起動 ----------

var IDLE_MINUTES = 30;   // この時間なにも操作がなければログアウト（共用の端末で開きっぱなしにされたとき用）

function watchIdle_() {
  var last = Date.now();
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { last = Date.now(); }, { passive: true, capture: true });
  });
  var check = function () {
    if (!Api.token || Date.now() - last < IDLE_MINUTES * 60000) return;
    logout();
    toast(IDLE_MINUTES + '分間操作がなかったため、ログアウトしました', 'err');
  };
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
}

function start() {
  // 別のサイトの枠（iframe）の中では開かない（重ねて押させる細工の対策）
  if (window.top !== window.self) {
    document.getElementById('app').textContent = 'このページは別のサイトの中では開けません。';
    return;
  }
  Api.load();
  watchIdle_();
  Api.onAuthLost = function (msg) {
    resetMember();
    resetAdmin();
    S.dialog = null;
    go('login');
    toast(msg, 'err');
  };
  window.matchMedia('(min-width: 900px)').addEventListener('change', function () { render(); });
  window.addEventListener('beforeunload', function (e) {
    if (['new', 'update', 'confirm', 'a-edit'].indexOf(S.screen) >= 0) { e.preventDefault(); e.returnValue = ''; }
  });
  if (Api.token && Api.role === 'officer') enterAdmin();
  else if (Api.token && Api.role === 'member') enterMember();
  else render();
}

document.addEventListener('DOMContentLoaded', start);
