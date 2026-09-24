/**
 * Code.gs — 入口（doPost）と共通の小道具
 *
 * 画面（GitHub Pages）から fetch(POST, Content-Type: text/plain, 本文はJSON) で呼ばれる。
 *   送信：{ "action": "…", "token": "…", …パラメータ }
 *   返信：{ "ok": true, "data": … } または { "ok": false, "error": "コード", "message": "日本語の説明" }
 * 認証・権限チェック・入力検証はすべてこのGAS側で行う。
 */

var APP_VERSION = '0.3.0';

// action → 必要な権限（null=ログイン不要, 'any'=ログインしていれば誰でも）と処理
var ROUTES = {
  ping:           { role: null,      fn: function () { return { version: APP_VERSION }; } },
  login:          { role: null,      fn: login_ },
  logout:         { role: 'any',     fn: logout_ },

  // 組合員（共通パスワードでログイン）
  checkDuplicate: { role: 'member',  fn: checkDuplicate_ },
  identify:       { role: 'member',  fn: identify_ },
  submitCreate:   { role: 'member',  fn: submitCreate_ },
  submitUpdate:   { role: 'member',  fn: submitUpdate_ },
  myRequests:     { role: 'member',  fn: myRequests_ },
  cancelRequest:  { role: 'member',  fn: cancelRequest_ },

  // 役員（管理パスワードでログイン）
  listMembers:    { role: 'officer', fn: listMembers_ },
  getMember:      { role: 'officer', fn: getMember_ },
  updateMember:   { role: 'officer', fn: updateMember_ },
  listRequests:   { role: 'officer', fn: listRequests_ },
  getRequest:     { role: 'officer', fn: getRequest_ },
  approve:        { role: 'officer', fn: approve_ },
  reject:         { role: 'officer', fn: reject_ },
  deleteMember:   { role: 'officer', fn: deleteMember_ },
  listTrash:      { role: 'officer', fn: listTrash_ },
  restoreMember:  { role: 'officer', fn: restoreMember_ },
  purgeMember:    { role: 'officer', fn: purgeMember_ },
  listHistory:    { role: 'officer', fn: listHistory_ },
  rollback:       { role: 'officer', fn: rollback_ },
  listLogs:       { role: 'officer', fn: listLogs_ }
};

function doPost(e) {
  var action = '';
  try {
    var p;
    try {
      p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (parseErr) {
      return json_({ ok: false, error: 'bad_request', message: '送信内容が正しくありません' });
    }
    if (!p || typeof p !== 'object') p = {};
    action = String(p.action || '');
    var route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
    if (!route) return json_({ ok: false, error: 'bad_action', message: '不正な操作です' });

    var session = null;
    if (route.role) {
      session = getSession_(p.token);
      if (!session) {
        return json_({ ok: false, error: 'auth', message: 'ログインの有効期限が切れました。もう一度ログインしてください' });
      }
      if (route.role !== 'any' && session.role !== route.role) {
        logAudit_(session.role, session.actor, 'denied', '', action);
        return json_({ ok: false, error: 'forbidden', message: 'この操作は許可されていません' });
      }
    }
    var data = route.fn(session, p);
    return json_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    if (err && err.appCode) {
      var out = { ok: false, error: err.appCode, message: err.message };
      if (err.extra) out.extra = err.extra;
      return json_(out);
    }
    // 内部エラーの詳細は画面に返さない（GASの実行ログにだけ残す）
    console.error('doPost(' + action + '): ' + (err && err.stack ? err.stack : err));
    return json_({ ok: false, error: 'internal', message: 'サーバーでエラーが起きました。時間をおいてもう一度お試しください' });
  }
}

/** ブラウザでURLを直接開いたとき用（動いているかの確認だけ） */
function doGet() {
  return json_({ ok: true, data: { version: APP_VERSION } });
}

// ---------- 共通の小道具 ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 画面に伝えるエラー（message は画面にそのまま出してよい文にする） */
function fail_(code, message, extra) {
  var e = new Error(message);
  e.appCode = code;
  if (extra) e.extra = extra;
  throw e;
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function setProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/** 日本時間の 'yyyy-MM-dd HH:mm:ss' */
function now_() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 長さに関係なく一定時間で比べる（パスワードのハッシュ比較用） */
function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** 同時に書き込まないように排他をかけて実行 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy', '混み合っています。少し待ってからもう一度お試しください');
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** CacheService の数を1増やして返す（回数制限用） */
function incr_(key, ttlSec) {
  var c = CacheService.getScriptCache();
  var n = Number(c.get(key) || 0) + 1;
  c.put(key, String(n), ttlSec);
  return n;
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function str_(v, max) {
  return String(v == null ? '' : v).slice(0, max || 200);
}
