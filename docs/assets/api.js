/*
 * api.js — GAS（Webアプリ）の呼び出し
 *
 * GAS_URL は公開情報（秘密ではない）。認証・権限チェックはすべて GAS 側で行う。
 * ログイン後のセッショントークンだけを sessionStorage に保存する（タブを閉じると消える）。
 */
'use strict';

var GAS_URL = 'https://script.google.com/macros/s/AKfycbx6gf6dE7ayikTDhv0YjtbFQttTdQATmNY6iR2MgDwefQoju31LbPi28r_QizNoEdZu/exec';
var API_TIMEOUT_MS = 25000;   // これ以上返事がなければ打ち切る
var HEDGE_MS = 6000;          // 読むだけの操作は、これだけ待っても返事がなければ同じものをもう1本送る
var SAFE_ACTIONS = {          // 2本送っても害のない操作（読むだけ・ログイン）
  ping: 1, login: 1, myRequests: 1,   // 本人確認（identify・checkDuplicate）は失敗回数を数えるので除く
  listMembers: 1, getMember: 1, listRequests: 1, getRequest: 1, listTrash: 1, listHistory: 1, listLogs: 1
};

var TOKEN_KEY = 'mp_token';
var ROLE_KEY = 'mp_role';
var ORG_KEY = 'mp_org';

function ApiError(code, message, extra) {
  this.code = code;
  this.message = message;
  this.extra = extra || null;
}

var Api = {
  token: null,
  role: null,
  org: null,          // 組織名（ログイン時に GAS から受け取る。リポジトリには書かない）
  onAuthLost: null,   // ログイン切れのときに呼ばれる（app.js が設定）

  load: function () {
    try {
      this.token = sessionStorage.getItem(TOKEN_KEY);
      this.role = sessionStorage.getItem(ROLE_KEY);
      this.org = JSON.parse(sessionStorage.getItem(ORG_KEY) || 'null');
    } catch (e) { /* 保存できない環境では毎回ログイン */ }
  },

  save: function (token, role, org) {
    this.token = token;
    this.role = role;
    this.org = org || null;
    try {
      if (token) {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(ROLE_KEY, role);
        sessionStorage.setItem(ORG_KEY, JSON.stringify(this.org));
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(ROLE_KEY);
        sessionStorage.removeItem(ORG_KEY);
      }
    } catch (e) { /* 無視 */ }
  },

  /** 1回の送信。返事（JSON）を返す。25秒で打ち切る */
  send_: function (body) {
    // サーバーが返さないとき、画面が固まったままにならないよう一定時間で打ち切る
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    var timer = ctrl ? setTimeout(function () { timedOut = true; ctrl.abort(); }, API_TIMEOUT_MS) : null;
    return fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain にして CORS の事前確認を避ける
      body: JSON.stringify(body),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json();
    }, function () {
      if (timedOut) throw new ApiError('timeout', '応答に時間がかかっています。少し待ってから、もう一度お試しください');
      throw new ApiError('network', '通信できませんでした。電波の良いところで、もう一度お試しください');
    }).then(function (v) {
      clearTimeout(timer);
      return v;
    }, function (e) {
      clearTimeout(timer);
      throw e;
    });
  },

  /**
   * 読むだけの操作（と、やり直しても害のないログイン）は、返事が HEDGE_MS 秒来なければ
   * 同じ内容をもう1本送り、先に返ってきた方を使う。GAS は起動が遅い・たまに詰まるので、
   * 待たされる時間を短くできる。通信エラーも1回だけ自動で送り直す。
   * 書き込み（申請・承認・削除など）は二重に実行されると困るので、この処理は使わない。
   */
  sendSafe_: function (body) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var pending = 0, sent = 0, done = false, lastErr = null, hedge = null;
      function finish(fn, v) { if (done) return; done = true; clearTimeout(hedge); fn(v); }
      function fire() {
        pending++; sent++;
        self.send_(body).then(function (json) { finish(resolve, json); }, function (e) {
          lastErr = e;
          pending--;
          if (done) return;
          if (sent < 2) fire();                    // 失敗したら待たずに1回だけ送り直す
          else if (pending === 0) finish(reject, lastErr);
        });
      }
      fire();
      hedge = setTimeout(function () { if (!done && sent < 2) fire(); }, HEDGE_MS);
    });
  },

  /** action を呼んで data を返す。失敗は ApiError を投げる */
  call: function (action, params) {
    var body = Object.assign({}, params || {}, { action: action });
    if (this.token) body.token = this.token;
    var self = this;
    return (SAFE_ACTIONS[action] ? this.sendSafe_(body) : this.send_(body)).then(function (json) {
      if (json && json.ok) return json.data;
      var err = new ApiError((json && json.error) || 'internal',
                             (json && json.message) || 'サーバーでエラーが起きました', json && json.extra);
      // auth：ログイン切れ／locked で「ログアウトしました」：本人確認の失敗が続いてサーバー側でログアウト済み
      if (err.code === 'auth' || (err.code === 'locked' && /ログアウト/.test(err.message))) {
        self.save(null, null, null);
        if (self.onAuthLost) self.onAuthLost(err.message);
      }
      throw err;
    }, function (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('internal', 'サーバーから正しい返事がありませんでした。時間をおいてお試しください');
    });
  }
};

/** 組織名（未設定なら空欄） */
function orgInfo() {
  var o = Api.org || {};
  return { title: o.title || '組合員台帳', honbu: o.honbu || '', branch: o.branch || '', bunkai: o.bunkai || '' };
}

function orgLine() {
  var o = orgInfo();
  return [o.honbu, o.branch, o.bunkai].filter(Boolean).join('　');
}
