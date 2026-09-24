/**
 * requests.gs — 新規・更新の申請（組合員）と、承認・却下（役員）
 *
 * ルール
 *  ・組合員は台帳を直接変えられない。申請 → 役員が承認して初めて反映
 *  ・申請は何回でも出せるが、承認待ちで残るのは1人（requester_key）につき最新の1件だけ。
 *    古い承認待ちは superseded（置き換え済み）になり、承認待ち一覧に出なくなる
 *  ・申請時の台帳の updated_at を base_updated_at に保存し、承認時に変わっていたら止める
 *  ・書き込みはすべて LockService で排他
 */

var STATUS_LABELS = {
  pending: '承認待ち', approved: '承認済み', rejected: '却下',
  cancelled: '取り消し', superseded: '置き換え済み'
};

var REPLACED_NOTE = '間違えた場合は、もう一度申請すれば前回の申請は破棄され、新しい内容に更新されます';

/** 同じ人の承認待ちを置き換え済みにする。置き換えた件数を返す */
function supersedePending_(key, newRequestId) {
  var n = 0;
  readAll_('change_requests').forEach(function (r) {
    if (r.requester_key === key && r.status === 'pending') {
      r.status = 'superseded';
      r.superseded_by = newRequestId;
      updateRow_('change_requests', r);
      logAudit_('member', keyLabel_(key), 'request_supersede', r.request_id, '→ ' + newRequestId);
      n++;
    }
  });
  return n;
}

function codeUsedByOther_(code, exceptMemberId) {
  return readAll_('members').some(function (m) {
    return m.employee_code === code && m.member_id !== exceptMemberId;
  });
}

/**
 * action: submitCreate（組合員）{ record: {…本人の項目}, family: [{…}, …] }
 */
function submitCreate_(session, p) {
  var rec = normalizeRecord_(p.record, p.family);
  var code = rec.member.employee_code, birth = rec.member.birth_date;
  guardVerify_(session);
  var key = requesterKey_(code, birth);

  return withLock_(function () {
    if (findMemberByIdentity_(code, birth)) {
      fail_('registered', '登録済みです。「更新」から変更してください');
    }
    if (codeUsedByOther_(code, '')) {
      recordMiss_(session);
      fail_('code_conflict', 'この社員番号では新規申請できません。分会の役員にお問い合わせください');
    }
    countRequest_(key);
    var id = newId_('R');
    var replaced = supersedePending_(key, id);
    appendRows_('change_requests', [{
      request_id: id, type: 'create', member_id: '', requested_at: now_(), requester_key: key,
      before_json: '', after_json: JSON.stringify(rec), base_updated_at: '', status: 'pending',
      superseded_by: '', reviewed_by: '', reviewed_at: '', reject_reason: '', notified: ''
    }]);
    logAudit_('member', keyLabel_(key), 'request_create', id, '全項目');
    return { request_id: id, replaced: replaced, note: REPLACED_NOTE };
  });
}

/**
 * action: submitUpdate（組合員）
 *   { auth: { employee_code, birth_date }, record: {…}, family: [{…}] }
 *   auth は本人確認に使った値（record の中で社員番号・生年月日を直していてもよい）
 */
function submitUpdate_(session, p) {
  var auth = p.auth || {};
  var id = normIdentity_(auth.employee_code, auth.birth_date);
  var rec = normalizeRecord_(p.record, p.family);
  guardVerify_(session);
  var key = requesterKey_(id.code, id.birth);

  return withLock_(function () {
    var m = findMemberByIdentity_(id.code, id.birth);
    if (!m) {
      recordMiss_(session);
      fail_('not_found', '見つかりません。社員番号と生年月日を確かめてください');
    }
    var before = snapshot_(m);
    var fields = changedFields_(before.member, rec.member);
    var famChanged = familyChanged_(before.family, rec.family);
    if (!fields.length && !famChanged) fail_('no_change', '変更された項目がありません');
    if (rec.member.employee_code !== m.employee_code && codeUsedByOther_(rec.member.employee_code, m.member_id)) {
      fail_('code_conflict', 'その社員番号は別の台帳で使われています。分会の役員にお問い合わせください');
    }
    countRequest_(key);
    var rid = newId_('R');
    var replaced = supersedePending_(key, rid);
    appendRows_('change_requests', [{
      request_id: rid, type: 'update', member_id: m.member_id, requested_at: now_(), requester_key: key,
      before_json: JSON.stringify(before), after_json: JSON.stringify(rec), base_updated_at: m.updated_at,
      status: 'pending', superseded_by: '', reviewed_by: '', reviewed_at: '', reject_reason: '', notified: ''
    }]);
    logAudit_('member', keyLabel_(key), 'request_update', rid, changedLabels_(fields, famChanged));
    return { request_id: rid, replaced: replaced, note: REPLACED_NOTE };
  });
}

/**
 * action: myRequests（組合員）{ employee_code, birth_date } → 自分の申請の状況（新しい順10件）
 *   中身（住所など）は返さず、状況と却下理由だけ
 */
function myRequests_(session, p) {
  var id = normIdentity_(p.employee_code, p.birth_date);
  guardVerify_(session);
  var items = myRequestItems_(requesterKey_(id.code, id.birth));
  if (!items.length) recordMiss_(session);
  return { items: items };
}

/** 本人の申請の状況（新しい順10件）。中身（住所など）は入れない */
function myRequestItems_(key) {
  return readAll_('change_requests').filter(function (r) {
    return r.requester_key === key;
  }).reverse().slice(0, 10).map(function (r) {
    return { request_id: r.request_id, type: r.type, requested_at: r.requested_at, status: r.status,
             statusLabel: STATUS_LABELS[r.status] || r.status, reviewed_at: r.reviewed_at,
             reject_reason: r.status === 'rejected' ? r.reject_reason : '' };
  });
}

/** action: cancelRequest（組合員）{ employee_code, birth_date, request_id } → 承認待ちを取り消す */
function cancelRequest_(session, p) {
  var id = normIdentity_(p.employee_code, p.birth_date);
  guardVerify_(session);
  var key = requesterKey_(id.code, id.birth);
  return withLock_(function () {
    var r = readAll_('change_requests').filter(function (x) { return x.request_id === String(p.request_id || ''); })[0];
    if (!r || r.requester_key !== key) {
      recordMiss_(session);
      fail_('not_found', '申請が見つかりません');
    }
    if (r.status !== 'pending') fail_('not_pending', 'この申請はすでに' + (STATUS_LABELS[r.status] || '処理済み') + 'です');
    r.status = 'cancelled';
    r.reviewed_at = now_();
    updateRow_('change_requests', r);
    logAudit_('member', keyLabel_(key), 'request_cancel', r.request_id, '');
    return { request_id: r.request_id, status: r.status };
  });
}

// ---------- 役員 ----------

/** requester_key ごとの「直近で続けて却下された回数」 */
function rejectStreaks_(reqs) {
  var streak = {}, done = {};
  reqs.slice().reverse().forEach(function (r) {
    if (done[r.requester_key]) return;
    if (r.status === 'rejected') streak[r.requester_key] = (streak[r.requester_key] || 0) + 1;
    else if (r.status === 'approved') done[r.requester_key] = true;
  });
  return streak;
}

/** 申請の中身と、いまの台帳を見比べる */
function compareRequest_(r) {
  var after = JSON.parse(r.after_json);
  if (r.type === 'create') {
    return { after: after, before: null, fields: [], famChanged: false, stale: false, current: null };
  }
  var m = findMemberById_(r.member_id);
  if (!m || isDeleted_(m)) {
    return { after: after, before: null, fields: [], famChanged: false, stale: false, current: null, gone: true };
  }
  var before = snapshot_(m);
  return {
    after: after, before: before,
    fields: changedFields_(before.member, after.member),
    famChanged: familyChanged_(before.family, after.family),
    stale: m.updated_at !== r.base_updated_at,
    current: m
  };
}

/** action: listRequests（役員）→ 承認待ちの一覧（新しい順）。中身は getRequest で */
function listRequests_(session, p) {
  var all = readAll_('change_requests');
  var streaks = rejectStreaks_(all);
  var items = all.filter(function (r) { return r.status === 'pending'; }).reverse().map(function (r) {
    var c = compareRequest_(r), a = c.after.member;
    return {
      request_id: r.request_id, type: r.type, requested_at: r.requested_at,
      employee_code: a.employee_code, name: a.sei + ' ' + a.mei, kana: a.sei_kana + ' ' + a.mei_kana,
      changes: r.type === 'create' ? '新規登録' : changedLabels_(c.fields, c.famChanged),
      stale: c.stale, gone: !!c.gone,
      requester: keyLabel_(r.requester_key), rejectStreak: streaks[r.requester_key] || 0
    };
  });
  logAudit_(session.role, session.actor, 'view_list', '', '承認待ち・' + items.length + '件');
  return { items: items };
}

/**
 * action: getRequest（役員）{ request_id }
 *   → 申請内容（after）と、いまの台帳（before）、変更のあった項目ID
 *   diff は「いまの台帳」と比べる（承認するとこの差分が反映される）
 */
function getRequest_(session, p) {
  var r = readAll_('change_requests').filter(function (x) { return x.request_id === String(p.request_id || ''); })[0];
  if (!r) fail_('not_found', '申請が見つかりません');
  var c = compareRequest_(r);
  logAudit_(session.role, session.actor, 'view_detail', r.request_id, '申請');
  return {
    request: { request_id: r.request_id, type: r.type, requested_at: r.requested_at, status: r.status,
               statusLabel: STATUS_LABELS[r.status], superseded_by: r.superseded_by,
               requester: keyLabel_(r.requester_key) },
    before: c.before, after: c.after, changedFields: c.fields, familyChanged: c.famChanged,
    stale: c.stale, gone: !!c.gone,
    base_updated_at: r.base_updated_at, current_updated_at: c.current ? c.current.updated_at : ''
  };
}

function findPendingForReview_(requestId) {
  var r = readAll_('change_requests').filter(function (x) { return x.request_id === String(requestId || ''); })[0];
  if (!r) fail_('not_found', '申請が見つかりません');
  if (r.status === 'superseded') {
    fail_('superseded', 'この申請は新しい申請に置き換えられました。承認待ち一覧を開き直してください');
  }
  if (r.status !== 'pending') fail_('not_pending', 'この申請はすでに' + (STATUS_LABELS[r.status] || '処理済み') + 'です');
  return r;
}

/**
 * action: approve（役員）{ request_id, ack_stale?: true, seen_updated_at?: '…' }
 *   申請のあとに台帳が変わっていたら stale で止める。
 *   役員が最新の内容と見比べたうえで ack_stale と、そのとき見た current_updated_at を付けて再承認する
 */
function approve_(session, p) {
  return withLock_(function () {
    var r = findPendingForReview_(p.request_id);
    var after = JSON.parse(r.after_json);
    var labels, memberId;

    if (r.type === 'create') {
      if (codeUsedByOther_(after.member.employee_code, '')) {
        fail_('duplicate', '同じ社員番号の台帳がすでにあります（ゴミ箱も確認してください）');
      }
      var created = { member_id: newId_('M'), created_at: now_(), deleted: '', deleted_at: '', deleted_by: '' };
      writeMember_(created, after.member, session.actor);
      replaceFamily_(created.member_id, after.family || []);
      memberId = created.member_id;
      r.member_id = memberId;
      labels = '新規登録';
    } else {
      var m = findMemberById_(r.member_id);
      if (!m || isDeleted_(m)) fail_('gone', '対象の台帳が見つかりません（ゴミ箱に移動された可能性があります）');
      if (m.updated_at !== r.base_updated_at && !(p.ack_stale && p.seen_updated_at === m.updated_at)) {
        fail_('stale', '申請のあとに台帳が更新されています。最新の内容と見比べてから、もう一度承認してください',
              { current_updated_at: m.updated_at });
      }
      if (codeUsedByOther_(after.member.employee_code, m.member_id)) {
        fail_('duplicate', 'その社員番号は別の台帳で使われています');
      }
      var before = snapshot_(m);
      addHistory_(m.member_id, session.actor, 'approve', before);
      writeMember_(m, after.member, session.actor);
      replaceFamily_(m.member_id, after.family || []);
      memberId = m.member_id;
      labels = changedLabels_(changedFields_(before.member, after.member), familyChanged_(before.family, after.family));
    }

    r.status = 'approved';
    r.reviewed_by = session.actor;
    r.reviewed_at = now_();
    updateRow_('change_requests', r);
    logAudit_(session.role, session.actor, 'approve', memberId, labels);
    return { request_id: r.request_id, member_id: memberId };
  });
}

/** action: reject（役員）{ request_id, reason } 理由は必須。本人の申請状況に表示される */
function reject_(session, p) {
  var reason = cleanText_(p.reason);
  if (!reason) fail_('invalid', '却下の理由を入力してください');
  if (reason.length > 200) fail_('invalid', '理由は200文字以内で入力してください');
  return withLock_(function () {
    var r = findPendingForReview_(p.request_id);
    r.status = 'rejected';
    r.reject_reason = reason;
    r.reviewed_by = session.actor;
    r.reviewed_at = now_();
    updateRow_('change_requests', r);
    logAudit_(session.role, session.actor, 'reject', r.request_id, '理由あり');   // 理由の文面はログに書かない
    return { request_id: r.request_id };
  });
}
