/**
 * trash.gs — ゴミ箱（論理削除・復元・完全削除）
 *
 *  ・削除：deleted=TRUE にするだけ（家族も一緒）。一覧・検索には出なくなる。いつでも復元できる
 *  ・完全削除：削除から PURGE_DAYS 日たったものだけ。管理パスワードの再入力が必要。実行前に自動バックアップ
 *  ・どれも audit_log と members_history に記録
 */

var PURGE_DAYS = 90;

function daysSince_(ts) {
  var t = new Date(String(ts).replace(' ', 'T') + '+09:00').getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

/** action: deleteMember（役員）{ member_id } → ゴミ箱へ移動 */
function deleteMember_(session, p) {
  return withLock_(function () {
    var m = findMemberById_(p.member_id);
    if (!m || isDeleted_(m)) fail_('not_found', '台帳が見つかりません');
    addHistory_(m.member_id, session.actor, 'delete', snapshot_(m));
    m.deleted = 'TRUE';
    m.deleted_at = now_();
    m.deleted_by = session.actor;
    updateRow_('members', m);
    familyRows_(m.member_id).forEach(function (f) { f.deleted = 'TRUE'; updateRow_('family', f); });
    logAudit_(session.role, session.actor, 'delete', m.member_id, 'ゴミ箱へ移動');
    return { member_id: m.member_id };
  });
}

/** action: listTrash（役員）→ 氏名・分会・削除日時・削除した人・完全削除できるか だけ */
function listTrash_(session, p) {
  var bunkai = org_().bunkai;
  var items = readAll_('members').filter(isDeleted_).sort(function (a, b) {
    return a.deleted_at < b.deleted_at ? 1 : -1;
  }).map(function (m) {
    var days = daysSince_(m.deleted_at);
    return { member_id: m.member_id, name: m.sei + ' ' + m.mei, bunkai: bunkai,
             deleted_at: m.deleted_at, deleted_by: m.deleted_by,
             canPurge: days >= PURGE_DAYS, daysLeft: Math.max(0, PURGE_DAYS - days) };
  });
  logAudit_(session.role, session.actor, 'view_list', '', 'ゴミ箱・' + items.length + '件');
  return { items: items, purgeDays: PURGE_DAYS };
}

/** action: restoreMember（役員）{ member_id } → 家族も一緒に一覧へ戻す */
function restoreMember_(session, p) {
  return withLock_(function () {
    var m = findMemberById_(p.member_id);
    if (!m || !isDeleted_(m)) fail_('not_found', 'ゴミ箱に見つかりません');
    var dup = activeMembers_().some(function (x) { return x.employee_code === m.employee_code; });
    if (dup) fail_('duplicate', '同じ社員番号の台帳がすでにあるため復元できません');
    m.deleted = '';
    m.deleted_at = '';
    m.deleted_by = '';
    updateRow_('members', m);
    familyRows_(m.member_id).forEach(function (f) { f.deleted = ''; updateRow_('family', f); });
    addHistory_(m.member_id, session.actor, 'restore', null);
    logAudit_(session.role, session.actor, 'restore', m.member_id, '');
    return { member_id: m.member_id };
  });
}

/**
 * action: purgeMember（役員）{ member_id, password } → 完全削除
 *   台帳・家族・申請・変更履歴から、その人のデータをすべて消す（消す前にスプレッドシート全体をバックアップ）
 */
function purgeMember_(session, p) {
  var target = findMemberById_(p.member_id);
  if (!target || !isDeleted_(target)) fail_('not_found', 'ゴミ箱に見つかりません');
  var days = daysSince_(target.deleted_at);
  if (days < PURGE_DAYS) {
    fail_('too_early', '削除から' + PURGE_DAYS + '日たっていないため、まだ完全削除できません（あと' + (PURGE_DAYS - days) + '日）');
  }
  checkPasswordAttempt_('officer', p.password);
  return withLock_(function () {
    var m = findMemberById_(p.member_id);
    if (!m || !isDeleted_(m)) fail_('not_found', 'ゴミ箱に見つかりません');
    backupNow_('完全削除前');

    var id = m.member_id;
    deleteRows_('family', familyRows_(id).map(function (f) { return f._row; }));
    deleteRows_('change_requests', readAll_('change_requests').filter(function (r) {
      return r.member_id === id;
    }).map(function (r) { return r._row; }));
    deleteRows_('members_history', readAll_('members_history').filter(function (h) {
      return h.member_id === id;
    }).map(function (h) { return h._row; }));
    deleteRows_('members', [m._row]);

    addHistory_(id, session.actor, 'purge', null);   // 中身は残さない（消したという記録だけ）
    logAudit_(session.role, session.actor, 'purge', id, '');
    return { member_id: id };
  });
}
