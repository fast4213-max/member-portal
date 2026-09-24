/**
 * db.gs — スプレッドシートの読み書き
 *
 * ・全セルを「書式なしテキスト」で保存（社員番号の先頭0や日付が勝手に変換されないように）
 * ・数式インジェクション対策：先頭が = + - @ の文字列は ' を付けて保存し、読むときに外す
 */

function ss_() {
  if (!ss_.cached) {
    var id = prop_('SPREADSHEET_ID');
    if (!id) throw new Error('SPREADSHEET_ID が未設定です（メニュー「① 初期設定」を実行してください）');
    ss_.cached = SpreadsheetApp.openById(id);
  }
  return ss_.cached;
}

function sheet_(name) {
  if (sheetCache_[name]) return sheetCache_[name];
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません（メニュー「① 初期設定」を実行してください）');
  return (sheetCache_[name] = sh);
}

// ---------- 1回の実行の中だけの読み込みキャッシュ（速度対策）----------
// スプレッドシートの読み込みは1回ごとに時間がかかるので、同じシートは1回だけ読む。
// 書き込んだシートと、排他を取った時点（ほかの人が書いたかもしれない）でキャッシュを捨てる。
var sheetCache_ = {};
var readCache_ = {};

function clearReadCache_(name) {
  if (name) delete readCache_[name]; else readCache_ = {};
}

function esc_(v) {
  var s = v == null ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function unesc_(s) {
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

/** シートの全行をオブジェクトの配列で返す（_row に行番号） */
function readAll_(name) {
  var headers = SHEETS[name], vals = readCache_[name];
  if (!vals) {
    var sh = sheet_(name), n = sh.getLastRow() - 1;
    vals = readCache_[name] = n > 0 ? sh.getRange(2, 1, n, headers.length).getDisplayValues() : [];
  }
  return rowsToObjects_(name, vals, 2);
}

/** 読んだ値（2次元配列）をオブジェクトの配列にする。毎回新しく作るので書き換えてもキャッシュは汚れない */
function rowsToObjects_(name, vals, firstRow) {
  var headers = SHEETS[name];
  return vals.map(function (r, i) {
    var o = { _row: i + firstRow };
    headers.forEach(function (h, j) { o[h] = unesc_(r[j]); });
    return o;
  });
}

function toRow_(name, obj) {
  return SHEETS[name].map(function (h) { return esc_(obj[h]); });
}

/** 末尾に行を追加 */
function appendRows_(name, objs) {
  if (!objs.length) return;
  clearReadCache_(name);
  var sh = sheet_(name), width = SHEETS[name].length;
  var start = sh.getLastRow() + 1, end = start + objs.length - 1;
  if (end > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), end - sh.getMaxRows());
  sh.getRange(start, 1, objs.length, width)
    .setNumberFormat('@')
    .setValues(objs.map(function (o) { return toRow_(name, o); }));
}

/** readAll_ で読んだ行（_row 付き）を書き戻す */
function updateRow_(name, obj) {
  if (!obj._row) throw new Error('updateRow_: _row がありません');
  clearReadCache_(name);
  sheet_(name).getRange(obj._row, 1, 1, SHEETS[name].length)
    .setNumberFormat('@')
    .setValues([toRow_(name, obj)]);
}

/** 行を削除（下の行から消すので行番号がずれない） */
function deleteRows_(name, rowNumbers) {
  clearReadCache_(name);
  var sh = sheet_(name);
  rowNumbers.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

// ---------- 台帳（members / family）----------

function isDeleted_(m) {
  return String(m.deleted).toUpperCase() === 'TRUE';
}

function activeMembers_() {
  return readAll_('members').filter(function (m) { return !isDeleted_(m); });
}

function findMemberById_(memberId) {
  if (!memberId) return null;
  return readAll_('members').filter(function (m) { return m.member_id === String(memberId); })[0] || null;
}

/** 社員番号＋生年月日で有効な台帳を探す（生年月日は 'YYYY-MM-DD' 同士で比べる） */
function findMemberByIdentity_(code, birth) {
  return activeMembers_().filter(function (m) {
    return m.employee_code === code && m.birth_date === birth;
  })[0] || null;
}

function familyRows_(memberId) {
  return readAll_('family').filter(function (f) { return f.member_id === memberId; });
}

/** 画面に返す本人の項目 */
function memberView_(m) {
  var org = org_();
  var o = { member_id: m.member_id, honbu: org.honbu, branch: org.branch, bunkai: org.bunkai,
            created_at: m.created_at, updated_at: m.updated_at };
  MEMBER_FIELDS.forEach(function (f) { o[f.id] = m[f.id] || ''; });
  return o;
}

function familyView_(rows) {
  return rows.map(function (r) {
    var o = {};
    FAMILY_FIELDS.forEach(function (f) { o[f.id] = r[f.id] || ''; });
    return o;
  });
}

/** 変更履歴用：本人の行と家族をまとめたもの */
function snapshot_(m) {
  return { member: memberView_(m), family: familyView_(familyRows_(m.member_id)) };
}

/** 家族を入れ替える（古い行は削除して新しい行を追加） */
function replaceFamily_(memberId, family) {
  var old = familyRows_(memberId).map(function (f) { return f._row; });
  deleteRows_('family', old);
  appendRows_('family', family.map(function (fm) {
    var o = { family_id: newId_('F'), member_id: memberId, deleted: '' };
    FAMILY_FIELDS.forEach(function (f) { o[f.id] = fm[f.id] || ''; });
    return o;
  }));
}

/** 本人の項目を書き込む（m は既存の行、data は新しい内容） */
function writeMember_(m, data, by) {
  MEMBER_FIELDS.forEach(function (f) { m[f.id] = data[f.id] || ''; });
  var org = org_();
  m.honbu = org.honbu; m.branch = org.branch; m.bunkai = org.bunkai;
  m.updated_at = now_();
  m.updated_by = by;
  if (m._row) updateRow_('members', m); else appendRows_('members', [m]);
  return m;
}

function addHistory_(memberId, by, reason, snapshot) {
  appendRows_('members_history', [{
    history_id: newId_('H'), member_id: memberId, changed_at: now_(), changed_by: by,
    reason: reason, snapshot_json: snapshot ? JSON.stringify(snapshot) : ''
  }]);
}
