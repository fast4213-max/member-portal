/*
 * api.js — GAS（Webアプリ）の呼び出し
 *
 * GAS_URL は公開情報（秘密ではない）。認証・権限チェックはすべて GAS 側で行う。
 * ログイン後のセッショントークンだけを sessionStorage に保存する（タブを閉じると消える）。
 */
'use strict';

var GAS_URL = 'https://script.google.com/macros/s/AKfycbx6gf6dE7ayikTDhv0YjtbFQttTdQATmNY6iR2MgDwefQoju31LbPi28r_QizNoEdZu/exec';

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

  /** action を呼んで data を返す。失敗は ApiError を投げる */
  call: function (action, params) {
    var body = Object.assign({}, params || {}, { action: action });
    if (this.token) body.token = this.token;
    var self = this;
    return fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain にして CORS の事前確認を避ける
      body: JSON.stringify(body),
      redirect: 'follow',
      cache: 'no-store'
    }).then(function (res) {
      return res.json();
    }, function () {
      throw new ApiError('network', '通信できませんでした。電波の良いところで、もう一度お試しください');
    }).then(function (json) {
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
