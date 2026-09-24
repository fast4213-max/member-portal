/**
 * test.gs — 動作テスト（メニュー「④ 動作テスト」）
 *
 * 架空の人（社員番号 0000000・山田 太郎）で、申請 → 置き換え → 承認 → 更新 → 却下 → 取消 →
 * 削除 → 復元 → 以前の版に戻す までを実際のシートで一通り動かし、最後にテストデータを消す。
 * 行動ログ（audit_log）は追記のみのため、テスト中の記録（操作者 #xxxxxxxx / selftest）は残る。
 */

var TEST_CODE = '0000000';
var TEST_BIRTH = '1990-04-12';

function menuSelfTest() {
  var r = ui_().alert('動作テスト',
    '架空のデータ（社員番号 0000000）で申請〜承認〜削除・復元までを実際のシートで試し、最後に消します。\n' +
    '1分ほどかかります。実行しますか？', ui_().ButtonSet.YES_NO);
  if (r !== ui_().Button.YES) return;
  var lines = runSelfTest_();
  var ng = lines.filter(function (l) { return l.indexOf('❌') === 0; }).length;
  alert_('動作テストの結果', (ng ? '❌ ' + ng + '件うまくいきませんでした\n\n' : '✅ すべてOK\n\n') + lines.join('\n'));
}

function testRecord_(over) {
  var rec = {
    sei: '山田', mei: '太郎', sei_kana: 'やまだ', mei_kana: 'タロウ', gender: '男',
    birth_date: '1990-4-12', job_title: '車掌', contract_join_date: '', regular_join_date: '2012-4-1',
    tel_home: '', tel_mobile: '０９０－００００－００００', zip: '0000000', address: '大阪府大阪市〇〇区〇〇町1-2-3',
    family_zip: '', family_address: '', family_tel: '', employee_code: TEST_CODE,
    station_home_line: '大阪環状線', station_home: '天王寺', station_family_line: '', station_family: '',
    kyosai_sogo: '加入済', kyosai_kyuen: '加入済', kotsu_seisaku: '未加入', kyosai_kazoku: '不明',
    prev_workplace: '', officer_exp: '無', officer_when: '', officer_detail: ''
  };
  Object.keys(over || {}).forEach(function (k) { rec[k] = over[k]; });
  return rec;
}

var TEST_FAMILY = [
  { sei: '山田', mei: '花子', sei_kana: 'ヤマダ', mei_kana: 'ハナコ', birth_date: '1992-8-3', gender: '女', relationship: '妻', living_together: '同居' },
  { sei: '山田', mei: '蒼太', sei_kana: 'ヤマダ', mei_kana: 'ソウタ', birth_date: '2020-5-20', gender: '男', relationship: '子', living_together: '同居' }
];

function cleanupTestData_() {
  var key = requesterKey_(TEST_CODE, TEST_BIRTH);
  var ids = readAll_('members').filter(function (m) { return m.employee_code === TEST_CODE; })
    .map(function (m) { return m.member_id; });
  var inIds = function (id) { return ids.indexOf(id) >= 0; };
  deleteRows_('family', readAll_('family').filter(function (f) { return inIds(f.member_id); }).map(function (f) { return f._row; }));
  deleteRows_('members_history', readAll_('members_history').filter(function (h) { return inIds(h.member_id); }).map(function (h) { return h._row; }));
  deleteRows_('change_requests', readAll_('change_requests').filter(function (r) {
    return r.requester_key === key || inIds(r.member_id);
  }).map(function (r) { return r._row; }));
  deleteRows_('members', readAll_('members').filter(function (m) { return inIds(m.member_id); }).map(function (m) { return m._row; }));
}

function runSelfTest_() {
  var out = [];
  var sm = { role: 'member', actor: '共通', token: 'selftest-member' };
  var so = { role: 'officer', actor: 'selftest', token: 'selftest-officer' };
  var cache = CacheService.getScriptCache();
  var key = requesterKey_(TEST_CODE, TEST_BIRTH);
  var day = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd');
  var ctx = {};

  var step = function (name, fn) {
    try {
      var note = fn();
      out.push('✅ ' + name + (note ? '（' + note + '）' : ''));
    } catch (e) {
      out.push('❌ ' + name + '：' + (e.appCode ? '[' + e.appCode + '] ' : '') + e.message);
    }
  };
  var ok = function (cond, msg) { if (!cond) throw new Error(msg); };
  var expectFail = function (code, fn) {
    try { fn(); } catch (e) {
      if (e.appCode === code) return e;
      throw e;
    }
    throw new Error('エラー「' + code + '」になるはずが成功しました');
  };
  var myPending = function () {
    return listRequests_(so, {}).items.filter(function (r) { return r.employee_code === TEST_CODE; });
  };

  cleanupTestData_();
  cache.removeAll(['vmiss:' + sm.token, 'rq:' + day + ':' + key]);

  step('入力の整形（全角→半角・ひらがな→カタカナ・1→01・郵便番号ハイフン）', function () {
    var r = normalizeRecord_(testRecord_(), TEST_FAMILY).member;
    ok(r.tel_mobile === '090-0000-0000', '電話 ' + r.tel_mobile);
    ok(r.birth_date === TEST_BIRTH, '生年月日 ' + r.birth_date);
    ok(r.sei_kana === 'ヤマダ', 'カナ ' + r.sei_kana);
    ok(r.zip === '000-0000', '郵便番号 ' + r.zip);
  });

  step('入力チェック（社員番号6桁・携帯なし・役員経験「有」で詳細なし → エラー）', function () {
    var e = expectFail('invalid', function () {
      normalizeRecord_(testRecord_({ employee_code: '123456', tel_mobile: '', officer_exp: '有' }), []);
    });
    var errs = e.extra.errors;
    ok(errs.employee_code && errs.tel_mobile && errs.officer_when && errs.officer_detail, JSON.stringify(errs));
  });

  step('新規：未登録の確認', function () {
    ok(checkDuplicate_(sm, { employee_code: TEST_CODE, birth_date: TEST_BIRTH }).registered === false, '登録済みと判定された');
  });

  step('新規申請を2回 → 1回目は置き換え済み、承認待ちは1件だけ', function () {
    ctx.first = submitCreate_(sm, { record: testRecord_(), family: TEST_FAMILY }).request_id;
    var second = submitCreate_(sm, { record: testRecord_({ job_title: '車掌（2回目）' }), family: TEST_FAMILY });
    ctx.create = second.request_id;
    ok(second.replaced === 1, '置き換え件数 ' + second.replaced);
    ok(myPending().length === 1, '承認待ち ' + myPending().length + '件');
  });

  step('置き換え済みの申請は承認できない', function () {
    expectFail('superseded', function () { approve_(so, { request_id: ctx.first }); });
  });

  step('新規申請を承認 → 台帳に登録', function () {
    ctx.memberId = approve_(so, { request_id: ctx.create }).member_id;
    ok(!!ctx.memberId, 'member_id なし');
  });

  step('新規：登録済みの確認（月日は 4-12 でも 04-12 でも一致）', function () {
    ok(checkDuplicate_(sm, { employee_code: TEST_CODE, birth_date: '1990-4-12' }).registered === true, '未登録と判定された');
    expectFail('registered', function () { submitCreate_(sm, { record: testRecord_(), family: [] }); });
  });

  step('更新：生年月日が違うと「見つかりません」', function () {
    expectFail('not_found', function () { identify_(sm, { employee_code: TEST_CODE, birth_date: '1990-04-13' }); });
  });

  step('更新：本人確認OKで現在の内容が返る', function () {
    var r = identify_(sm, { employee_code: TEST_CODE, birth_date: '1990年4月12日' });
    ok(r.member.job_title === '車掌（2回目）', '職名 ' + r.member.job_title);
    ok(r.family.length === 2, '家族 ' + r.family.length + '人');
  });

  step('役員：一覧（や行・社員番号で検索）は最小限の項目だけ', function () {
    var page = listMembers_(so, { row: 'ya', q: TEST_CODE });
    ok(page.items.length === 1, page.items.length + '件');
    var keys = Object.keys(page.items[0]).sort().join(',');
    ok(keys === 'age,employee_code,kana,member_id,name,updated_at', '返した項目 ' + keys);
  });

  step('役員：台帳の詳細', function () {
    var r = getMember_(so, { member_id: ctx.memberId });
    ok(r.member.address && r.family.length === 2, '内容が足りない');
  });

  step('更新申請：何も変えていなければ受け付けない', function () {
    expectFail('no_change', function () {
      submitUpdate_(sm, { auth: { employee_code: TEST_CODE, birth_date: TEST_BIRTH },
                          record: testRecord_({ job_title: '車掌（2回目）' }), family: TEST_FAMILY });
    });
  });

  step('更新申請 → 申請後に台帳が変わっていたら承認を止める → 見比べて再承認', function () {
    var auth = { employee_code: TEST_CODE, birth_date: TEST_BIRTH };
    var rid = submitUpdate_(sm, { auth: auth, record: testRecord_({ tel_mobile: '080-0000-1111' }), family: TEST_FAMILY }).request_id;
    var m = findMemberById_(ctx.memberId);
    m.updated_at = '2000-01-01 00:00:00';          // 申請のあとに誰かが更新した、という状態を作る
    updateRow_('members', m);
    var e = expectFail('stale', function () { approve_(so, { request_id: rid }); });
    approve_(so, { request_id: rid, ack_stale: true, seen_updated_at: e.extra.current_updated_at });
    ok(findMemberById_(ctx.memberId).tel_mobile === '080-0000-1111', '反映されていない');
  });

  step('却下：理由なしは不可 → 理由ありで却下 → 本人の申請状況に理由が出る', function () {
    var auth = { employee_code: TEST_CODE, birth_date: TEST_BIRTH };
    var rid = submitUpdate_(sm, { auth: auth, record: testRecord_({ tel_mobile: '080-0000-1111', address: '大阪府〇〇市' }), family: TEST_FAMILY }).request_id;
    expectFail('invalid', function () { reject_(so, { request_id: rid, reason: '' }); });
    reject_(so, { request_id: rid, reason: '住所の番地が抜けています' });
    var mine = myRequests_(sm, auth).items[0];
    ok(mine.status === 'rejected' && mine.reject_reason === '住所の番地が抜けています', JSON.stringify(mine));
  });

  step('取消：本人が承認待ちを取り消す（2回目はできない）', function () {
    var auth = { employee_code: TEST_CODE, birth_date: TEST_BIRTH };
    var rid = submitUpdate_(sm, { auth: auth, record: testRecord_({ tel_mobile: '080-0000-2222' }), family: TEST_FAMILY }).request_id;
    cancelRequest_(sm, { employee_code: TEST_CODE, birth_date: TEST_BIRTH, request_id: rid });
    expectFail('not_pending', function () {
      cancelRequest_(sm, { employee_code: TEST_CODE, birth_date: TEST_BIRTH, request_id: rid });
    });
  });

  step('数式インジェクション対策（「=1+1」が数式にならず文字のまま保存される）', function () {
    var auth = { employee_code: TEST_CODE, birth_date: TEST_BIRTH };
    var rid = submitUpdate_(sm, { auth: auth, record: testRecord_({ tel_mobile: '080-0000-1111', prev_workplace: '=1+1' }), family: TEST_FAMILY }).request_id;
    approve_(so, { request_id: rid });
    var m = findMemberById_(ctx.memberId);
    var col = SHEETS.members.indexOf('prev_workplace') + 1;
    ok(sheet_('members').getRange(m._row, col).getFormula() === '', '数式として保存された');
    ok(m.prev_workplace === '=1+1', '読み戻し ' + m.prev_workplace);
  });

  step('以前の版に戻す（前職場が元の空欄に戻る）', function () {
    var hist = listHistory_(so, { member_id: ctx.memberId }).items;
    ok(hist.length >= 2, '履歴 ' + hist.length + '件');
    rollback_(so, { history_id: hist[0].history_id });
    ok(findMemberById_(ctx.memberId).prev_workplace === '', '戻っていない');
  });

  step('役員の直接編集（開いたあとに更新されていたら止める → 正しく保存 → 履歴から戻せる）', function () {
    var cur = getMember_(so, { member_id: ctx.memberId });
    var rec = testRecord_({ tel_mobile: '080-0000-1111', job_title: '運転士' });
    expectFail('stale', function () {
      updateMember_(so, { member_id: ctx.memberId, base_updated_at: '2000-01-01 00:00:00', record: rec, family: TEST_FAMILY });
    });
    updateMember_(so, { member_id: ctx.memberId, base_updated_at: cur.member.updated_at, record: rec, family: TEST_FAMILY });
    ok(findMemberById_(ctx.memberId).job_title === '運転士', '反映されていない');
    var hist = listHistory_(so, { member_id: ctx.memberId }).items;
    ok(hist[0].reason === 'edit', '履歴 ' + hist[0].reason);
    rollback_(so, { history_id: hist[0].history_id });
    ok(findMemberById_(ctx.memberId).job_title === cur.member.job_title, '戻っていない');
  });

  step('ゴミ箱：削除 → 一覧から消える → 90日前は完全削除不可 → 復元', function () {
    deleteMember_(so, { member_id: ctx.memberId });
    ok(listMembers_(so, { q: TEST_CODE }).items.length === 0, '一覧に残っている');
    ok(listTrash_(so, {}).items.some(function (t) { return t.member_id === ctx.memberId; }), 'ゴミ箱にない');
    expectFail('not_found', function () { identify_(sm, { employee_code: TEST_CODE, birth_date: TEST_BIRTH }); });
    expectFail('too_early', function () { purgeMember_(so, { member_id: ctx.memberId, password: 'x' }); });
    restoreMember_(so, { member_id: ctx.memberId });
    ok(listMembers_(so, { q: TEST_CODE }).items.length === 1, '一覧に戻っていない');
    ok(getMember_(so, { member_id: ctx.memberId }).family.length === 2, '家族が戻っていない');
  });

  step('権限：組合員のログインで役員の操作は拒否・ログインなしは拒否', function () {
    var token = sha256Hex_('selftest' + Utilities.getUuid());
    cache.put('tok:' + token, JSON.stringify({ role: 'member', actor: '共通', epoch: prop_('TOKEN_EPOCH') || '0' }), 60);
    var call = function (body) {
      return JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
    };
    var r1 = call({ action: 'listMembers', token: token });
    var r2 = call({ action: 'listMembers' });
    var r3 = call({ action: 'nosuch' });
    cache.remove('tok:' + token);
    ok(r1.error === 'forbidden', '組合員→役員の操作：' + r1.error);
    ok(r2.error === 'auth', 'ログインなし：' + r2.error);
    ok(r3.error === 'bad_action', '存在しない操作：' + r3.error);
  });

  step('行動ログに住所・電話の値が書かれていない', function () {
    var bad = readAll_('audit_log').filter(function (l) {
      return /080-0000|090-0000|大阪府|住所の番地/.test(l.detail);
    });
    ok(bad.length === 0, bad.length + '件');
  });

  step('テストデータの後片付け', function () {
    cleanupTestData_();
    cache.removeAll(['vmiss:' + sm.token, 'rq:' + day + ':' + key]);
    ok(!readAll_('members').some(function (m) { return m.employee_code === TEST_CODE; }), '残っている');
  });

  return out;
}
