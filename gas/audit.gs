/**
 * audit.gs — 行動ログ（追記のみ。編集・削除するAPIは作らない）
 *
 * detail には項目名や回数だけを書き、住所・電話などの値は書かない。
 * 組合員の操作者は社員番号ではなく requester_key の先頭（#xxxxxxxx）で記録する。
 */

var LOG_PAGE_SIZE = 50;

var LOG_CATEGORIES = {
  login:   ['login_ok', 'login_fail', 'lockout', 'denied'],
  view:    ['view_list', 'view_detail', 'view_log', 'export'],
  request: ['request_create', 'request_update', 'request_supersede', 'request_cancel', 'request_limit'],
  review:  ['approve', 'reject'],
  trash:   ['delete', 'restore', 'purge', 'rollback']
};

function logAudit_(role, actor, action, targetId, detail) {
  appendRows_('audit_log', [{
    timestamp: now_(), role: role, actor: actor, action: action,
    target_id: targetId || '', detail: str_(detail, 300)
  }]);
}

/**
 * action: listLogs
 *   { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD', category?: 'login'|'view'|…, kind?: 'approve'…, actor?: 'admin'|'#xxxx', page?: 1 }
 *   （操作の種類は action という名前だとAPIの action とぶつかるので kind）
 */
function listLogs_(session, p) {
  var from = normDate_(p.from) || '', to = normDate_(p.to) || '';
  var cat = LOG_CATEGORIES[p.category] || null;
  var act = str_(p.kind, 40), actor = str_(p.actor, 40);

  var rows = readAll_('audit_log').filter(function (r) {
    var day = r.timestamp.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (cat && cat.indexOf(r.action) < 0) return false;
    if (act && r.action !== act) return false;
    if (actor && r.actor !== actor) return false;
    return true;
  }).reverse();

  var page = pageOf_(rows, p.page, LOG_PAGE_SIZE);
  var names = targetNames_();
  page.items = page.items.map(function (r) {
    return { timestamp: r.timestamp, role: r.role, actor: r.actor, action: r.action,
             target_id: r.target_id, target_name: names[r.target_id] || '', detail: r.detail };
  });
  logAudit_(session.role, session.actor, 'view_log', '', 'ページ' + page.page);
  return page;
}

/** ログの対象ID（台帳ID・申請ID）→ 氏名。ログのシートには氏名を書かず、表示のときだけ引く */
function targetNames_() {
  var names = {};
  readAll_('members').forEach(function (m) { names[m.member_id] = m.sei + ' ' + m.mei; });
  readAll_('change_requests').forEach(function (r) {
    try {
      var a = JSON.parse(r.after_json || '{}').member || {};
      names[r.request_id] = (a.sei || '') + ' ' + (a.mei || '');
    } catch (e) { /* 壊れた行は名前なし */ }
  });
  return names;
}

/** 配列をページに分ける（1ページ size 件） */
function pageOf_(rows, page, size) {
  var pages = Math.max(1, Math.ceil(rows.length / size));
  var n = Math.min(Math.max(1, parseInt(page, 10) || 1), pages);
  return { items: rows.slice((n - 1) * size, n * size), total: rows.length, page: n, pages: pages };
}
