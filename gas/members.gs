/**
 * members.gs — 本人確認（組合員）と、台帳の一覧・詳細・以前の版に戻す（役員）
 */

var LIST_PAGE_SIZE = 50;

/**
 * action: checkDuplicate（組合員・新規の最初）
 *   { employee_code, birth_date } → { registered: true/false } だけを返す
 */
function checkDuplicate_(session, p) {
  var id = normIdentity_(p.employee_code, p.birth_date);
  guardVerify_(session);
  var m = findMemberByIdentity_(id.code, id.birth);
  if (!m) recordMiss_(session);
  return { registered: !!m };
}

/**
 * action: identify（組合員・更新の最初）
 *   { employee_code, birth_date } → 本人の台帳（現在の内容）と、承認待ちの申請があるか
 *   一致しなければ「見つかりません」だけ（どちらが違うかは言わない）
 */
function identify_(session, p) {
  var id = normIdentity_(p.employee_code, p.birth_date);
  guardVerify_(session);
  var m = findMemberByIdentity_(id.code, id.birth);
  if (!m) {
    recordMiss_(session);
    fail_('not_found', '見つかりません。社員番号と生年月日を確かめてください');
  }
  var key = requesterKey_(id.code, id.birth);
  var mine = myRequestItems_(key);
  var pending = mine.some(function (r) { return r.status === 'pending'; });
  logAudit_('member', keyLabel_(key), 'view_detail', m.member_id, '本人');
  // 申請の状況もいっしょに返す（別に myRequests を呼ぶと1往復ぶん遅くなるため）
  return { member: memberView_(m), family: familyView_(familyRows_(m.member_id)), hasPending: pending, requests: mine };
}

/**
 * action: listMembers（役員）
 *   { row?: 'a'|'ka'|…|'wa', q?: 氏名・フリガナ・社員番号の一部, page?: 1 }
 *   返すのは 社員番号・氏名・フリガナ・年齢・更新日 だけ（住所・電話などは返さない）
 */
function listMembers_(session, p) {
  var chars = KANA_ROWS[p.row] || '';
  var q = str_(p.q, 40).trim();
  var qKana = toKana_(q), qCode = toHalf_(q).replace(/\s/g, '');

  var rows = activeMembers_().filter(function (m) {
    if (chars && chars.indexOf(m.sei_kana.charAt(0)) < 0) return false;
    if (q) {
      var hit = (m.sei + m.mei).indexOf(q.replace(/[\s　]/g, '')) >= 0 ||
                (qKana && (m.sei_kana + m.mei_kana).indexOf(qKana) >= 0) ||
                (/^\d+$/.test(qCode) && m.employee_code.indexOf(qCode) >= 0);
      if (!hit) return false;
    }
    return true;
  }).sort(function (a, b) {
    return (a.sei_kana + a.mei_kana).localeCompare(b.sei_kana + b.mei_kana, 'ja');
  });

  var page = pageOf_(rows, p.page, LIST_PAGE_SIZE);
  page.items = page.items.map(function (m) {
    return { member_id: m.member_id, employee_code: m.employee_code,
             name: m.sei + ' ' + m.mei, kana: m.sei_kana + ' ' + m.mei_kana,
             age: ageOf_(m.birth_date), updated_at: m.updated_at };
  });
  // 検索語は氏名のことがあるのでログには書かない
  logAudit_(session.role, session.actor, 'view_list', '',
            (chars ? p.row + '行' : 'すべて') + (q ? '・検索あり' : '') + '・' + page.total + '件');
  return page;
}

/** action: getMember（役員）{ member_id } → 1人分の全項目＋家族。見るたびにログに残す */
function getMember_(session, p) {
  var m = findMemberById_(p.member_id);
  if (!m || isDeleted_(m)) fail_('not_found', '台帳が見つかりません（削除された可能性があります）');
  logAudit_(session.role, session.actor, 'view_detail', m.member_id, '');
  return { member: memberView_(m), family: familyView_(familyRows_(m.member_id)) };
}

/** action: listHistory（役員）{ member_id } → 変更履歴の一覧（中身は rollback のときだけ使う） */
function listHistory_(session, p) {
  var id = String(p.member_id || '');
  var items = readAll_('members_history').filter(function (h) {
    return h.member_id === id && h.snapshot_json;
  }).reverse().slice(0, 50).map(function (h) {
    return { history_id: h.history_id, changed_at: h.changed_at, changed_by: h.changed_by, reason: h.reason };
  });
  logAudit_(session.role, session.actor, 'view_list', id, '変更履歴');
  return { items: items };
}

/**
 * action: rollback（役員）{ history_id } → その履歴の時点（変更前の内容）に戻す
 *   戻す前の内容も履歴に残すので、戻したこと自体も取り消せる
 */
function rollback_(session, p) {
  return withLock_(function () {
    var h = readAll_('members_history').filter(function (x) { return x.history_id === String(p.history_id || ''); })[0];
    if (!h || !h.snapshot_json) fail_('not_found', '履歴が見つかりません');
    var m = findMemberById_(h.member_id);
    if (!m || isDeleted_(m)) fail_('not_found', '台帳が見つかりません（ゴミ箱にある場合は先に復元してください）');

    var snap = JSON.parse(h.snapshot_json);
    var dup = activeMembers_().some(function (x) {
      return x.member_id !== m.member_id && x.employee_code === snap.member.employee_code;
    });
    if (dup) fail_('duplicate', 'この版の社員番号は、別の台帳で使われているため戻せません');

    var before = snapshot_(m);
    addHistory_(m.member_id, session.actor, 'rollback', before);
    writeMember_(m, snap.member, session.actor);
    replaceFamily_(m.member_id, snap.family || []);
    logAudit_(session.role, session.actor, 'rollback', m.member_id,
              changedLabels_(changedFields_(before.member, snap.member), familyChanged_(before.family, snap.family)));
    return { member_id: m.member_id, updated_at: m.updated_at };
  });
}

/**
 * action: updateMember（役員）{ member_id, base_updated_at, record, family }
 *   役員が台帳を直接直す（承認なしで反映）。変更前の内容は履歴に残すので rollback で戻せる
 *   開いたあとに誰かが台帳を変えていたら（updated_at が違えば）上書きせずに止める
 */
function updateMember_(session, p) {
  var rec = normalizeRecord_(p.record, p.family);
  return withLock_(function () {
    var m = findMemberById_(p.member_id);
    if (!m || isDeleted_(m)) fail_('not_found', '台帳が見つかりません（削除された可能性があります）');
    if (m.updated_at !== String(p.base_updated_at || '')) {
      fail_('stale', '編集している間に台帳が更新されました。台帳を開き直してから、もう一度編集してください');
    }
    if (codeUsedByOther_(rec.member.employee_code, m.member_id)) {
      fail_('duplicate', 'その社員番号は別の台帳で使われています');
    }
    var before = snapshot_(m);
    var fields = changedFields_(before.member, rec.member);
    var famChanged = familyChanged_(before.family, rec.family);
    if (!fields.length && !famChanged) fail_('no_change', '変更された項目がありません');

    addHistory_(m.member_id, session.actor, 'edit', before);
    writeMember_(m, rec.member, session.actor);
    replaceFamily_(m.member_id, rec.family);
    logAudit_(session.role, session.actor, 'edit', m.member_id, changedLabels_(fields, famChanged));
    return { member_id: m.member_id, updated_at: m.updated_at };
  });
}
