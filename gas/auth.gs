/**
 * auth.gs — ログイン・セッション・総当たり対策・本人確認の回数制限
 *
 * スクリプトプロパティ（値はリポジトリに書かない。メニューから設定する）
 *   PASS_SALT        … ハッシュ用のランダム文字列（初期設定で自動作成。変えるとパスワードの再設定が必要）
 *   MEMBER_PASS_HASH … 共通パスワードのハッシュ
 *   ADMIN_PASS_HASH  … 管理パスワードのハッシュ
 *   TOKEN_EPOCH      … 数字。増やすと全員のログインが無効になる
 */

var SESSION_HOURS = 6;               // ログインの有効時間（CacheService の上限が6時間）
var LOGIN_MAX_FAIL = 5;              // パスワードを続けて間違えられる回数
var LOCK_MINUTES = 15;               // ↑を超えたときのロック時間
var VERIFY_MAX_MISS_PER_LOGIN = 5;   // 本人確認（社員番号＋生年月日）の失敗：1回のログインあたり
var VERIFY_MAX_MISS_PER_HOUR = 300;  // 本人確認の失敗：全体で1時間あたり（総当たり対策）
var REQUESTS_PER_DAY = 20;           // 1人（requester_key）あたり1日の申請回数

var ROLE_NAMES = { member: '共通', officer: 'admin' };

function passHashKey_(role) {
  return role === 'officer' ? 'ADMIN_PASS_HASH' : 'MEMBER_PASS_HASH';
}

function hashPassword_(pw) {
  var salt = prop_('PASS_SALT');
  if (!salt) throw new Error('PASS_SALT が未設定です（メニュー「① 初期設定」を実行してください）');
  return sha256Hex_(salt + ':pw:' + pw);
}

/**
 * パスワードを照合する。間違いは回数を数え、上限でロックする。
 * ログインと完全削除時の再入力の両方で使う。
 */
function checkPasswordAttempt_(role, password) {
  var cache = CacheService.getScriptCache();
  var actor = ROLE_NAMES[role];
  if (cache.get('lock:' + role)) {
    fail_('locked', 'パスワードを続けて間違えたため、' + LOCK_MINUTES + '分間ログインできません。時間をおいてお試しください');
  }
  var stored = prop_(passHashKey_(role));
  if (!stored) fail_('not_configured', 'パスワードがまだ設定されていません。管理者に連絡してください');

  var pw = String(password == null ? '' : password);
  var ok = pw.length > 0 && pw.length <= 200 && safeEqual_(hashPassword_(pw), stored);
  if (ok) {
    cache.remove('fail:' + role);
    return;
  }
  var n = incr_('fail:' + role, LOCK_MINUTES * 60);
  logAudit_(role, actor, 'login_fail', '', n + '回目');
  if (n >= LOGIN_MAX_FAIL) {
    cache.put('lock:' + role, '1', LOCK_MINUTES * 60);
    cache.remove('fail:' + role);
    logAudit_(role, actor, 'lockout', '', 'ログイン ' + LOCK_MINUTES + '分');
    fail_('locked', 'パスワードを続けて間違えたため、' + LOCK_MINUTES + '分間ログインできません。時間をおいてお試しください');
  }
  fail_('bad_password', 'パスワードが違います');
}

/** action: login  { role: 'member' | 'officer', password } */
function login_(_, p) {
  var role = (p.role === 'officer' || p.role === 'admin') ? 'officer' : 'member';
  checkPasswordAttempt_(role, p.password);

  var token = sha256Hex_(Utilities.getUuid() + Utilities.getUuid() + Date.now());
  var session = { role: role, actor: ROLE_NAMES[role], epoch: prop_('TOKEN_EPOCH') || '0' };
  CacheService.getScriptCache().put('tok:' + token, JSON.stringify(session), SESSION_HOURS * 3600);
  logAudit_(role, session.actor, 'login_ok', '', '');
  return { token: token, role: role, expiresIn: SESSION_HOURS * 3600 };
}

/** トークンからセッションを取り出す。無効なら null */
function getSession_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  var raw = CacheService.getScriptCache().get('tok:' + token);
  if (!raw) return null;
  var s = JSON.parse(raw);
  if (s.epoch !== (prop_('TOKEN_EPOCH') || '0')) return null;   // 「全員をログアウト」済み
  s.token = token;
  return s;
}

/** action: logout */
function logout_(session) {
  CacheService.getScriptCache().remove('tok:' + session.token);
  return null;
}

/** 全員のログインを無効にする（パスワード漏えい時など。メニューから実行） */
function revokeAllSessions_() {
  setProp_('TOKEN_EPOCH', String(Number(prop_('TOKEN_EPOCH') || 0) + 1));
}

// ---------- 本人確認（社員番号＋生年月日）----------

/** 社員番号・生年月日そのものは保存せず、ハッシュにして申請の識別に使う */
function requesterKey_(code, birth) {
  return sha256Hex_(prop_('PASS_SALT') + ':rk:' + code + '|' + birth);
}

/** ログや画面に出す短い表記 */
function keyLabel_(key) {
  return '#' + String(key).slice(0, 8);
}

function hourKey_() {
  return 'vmiss:h:' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMddHH');
}

/** 本人確認の前に呼ぶ：制限に達していたら止める */
function guardVerify_(session) {
  var cache = CacheService.getScriptCache();
  if (Number(cache.get(hourKey_()) || 0) >= VERIFY_MAX_MISS_PER_HOUR) {
    fail_('busy', '本人確認の失敗が多いため、一時的に受付を止めています。1時間ほどおいてお試しください');
  }
}

/** 本人確認に失敗したときに呼ぶ：上限に達したらログアウトさせる */
function recordMiss_(session) {
  var n = incr_('vmiss:' + session.token, SESSION_HOURS * 3600);
  var h = incr_(hourKey_(), 3600);
  if (h === VERIFY_MAX_MISS_PER_HOUR) logAudit_('member', ROLE_NAMES.member, 'lockout', '', '本人確認（全体）');
  if (n >= VERIFY_MAX_MISS_PER_LOGIN) {
    CacheService.getScriptCache().remove('tok:' + session.token);
    logAudit_('member', ROLE_NAMES.member, 'lockout', '', '本人確認');
    fail_('locked', '本人確認に続けて失敗したため、ログアウトしました。社員番号と生年月日を確かめて、ログインからやり直してください');
  }
}

/** 1人1日あたりの申請回数を数える。上限を超えたら拒否 */
function countRequest_(key) {
  var day = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var n = incr_('rq:' + day + ':' + key, 24 * 3600);
  if (n > REQUESTS_PER_DAY) {
    logAudit_('member', keyLabel_(key), 'request_limit', '', '1日' + REQUESTS_PER_DAY + '回');
    fail_('too_many', '今日はこれ以上申請できません（1日' + REQUESTS_PER_DAY + '回まで）。明日もう一度お試しください');
  }
}
