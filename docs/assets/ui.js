/*
 * ui.js — 画面づくりの小道具（要素の作成・アイコン・入力の整形・チェック）
 *
 * XSS対策：画面に出す値はすべて h() 経由で textContent として入れる。
 * innerHTML を使うのはアイコン（このファイルに書いた固定の SVG）だけ。
 */
'use strict';

/** 要素を作る。子に文字列を渡すと文字として（HTMLとしてではなく）入る */
function h(tag, props) {
  var el = document.createElement(tag);
  props = props || {};
  Object.keys(props).forEach(function (k) {
    var v = props[k];
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled') el[k] = !!v;
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'ref') v(el);
    else el.setAttribute(k, v === true ? '' : String(v));
  });
  for (var i = 2; i < arguments.length; i++) append_(el, arguments[i]);
  return el;
}

function append_(el, c) {
  if (c == null || c === false) return;
  if (Array.isArray(c)) { c.forEach(function (x) { append_(el, x); }); return; }
  el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
}

// ---------- アイコン（固定のSVGだけ） ----------
var ICONS = {
  doc: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H17l3 3v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z"/><path d="M8 9h8"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  warn: '<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5v.01"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  personAdd: '<circle cx="10" cy="8" r="4"/><path d="M3 20c0-3.3 3.1-6 7-6 1.4 0 2.7.3 3.8.9"/><path d="M18 14v6"/><path d="M15 17h6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  list: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  approve: '<path d="M9 11l3 3 8-8"/><path d="M20 12v6.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H15"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.5"/><path d="M7 14h10v6H7z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/><path d="M8.5 11h5"/>'
};

function ico(name, size, extraStyle) {
  var s = size || 20;
  var wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;flex-shrink:0;' + (extraStyle || '');
  wrap.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  return wrap;
}

// ---------- 入力の整形（サーバー側でも同じ整形・チェックをしている） ----------

function toHalf(s) {
  return String(s == null ? '' : s)
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[－ー―‐−]/g, '-');
}

function toKana(s) {
  return String(s == null ? '' : s)
    .replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); })
    .replace(/[\s　]/g, '');
}

var TEL_FIELDS = ['tel_home', 'tel_mobile', 'family_tel'];

/** 入力欄から離れたときの整形（全角→半角、郵便番号のハイフンなど） */
function cleanValue(name, v) {
  if (name === 'employee_code' || name === 'code') return toHalf(v).replace(/\D/g, '').slice(0, 7);
  if (name === 'zip' || name === 'family_zip') {
    var dg = toHalf(v).replace(/\D/g, '').slice(0, 7);
    return dg.length > 3 ? dg.slice(0, 3) + '-' + dg.slice(3) : dg;
  }
  if (/(^|_)y$/.test(name)) return toHalf(v).replace(/\D/g, '').slice(0, 4);
  if (/(^|_)[md]$/.test(name)) return toHalf(v).replace(/\D/g, '').slice(0, 2);
  if (TEL_FIELDS.indexOf(name) >= 0) {
    var t = toHalf(v).replace(/[^\d-]/g, '').slice(0, 13);
    // 携帯（070/080/090 で11桁）はハイフンなしでもハイフンを入れる
    if (/^0[789]0\d{8}$/.test(t)) t = t.slice(0, 3) + '-' + t.slice(3, 7) + '-' + t.slice(7);
    return t;
  }
  if (/_kana$/.test(name)) return toKana(v);
  return String(v == null ? '' : v);
}

/** 年月日 → true(正しい) / false(間違い) / null(空) */
function validDate(y, m, d) {
  if (!y && !m && !d) return null;
  if (String(y).length !== 4 || !m || !d) return false;
  var dt = new Date(+y, +m - 1, +d);
  return dt.getFullYear() === +y && dt.getMonth() === +m - 1 && dt.getDate() === +d && +y >= 1900 && dt <= new Date();
}

function joinDate(y, m, d) {
  if (validDate(y, m, d) !== true) return '';
  return y + '-' + ('0' + (+m)).slice(-2) + '-' + ('0' + (+d)).slice(-2);
}

function splitDate(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? { y: m[1], m: String(+m[2]), d: String(+m[3]) } : { y: '', m: '', d: '' };
}

/** 'YYYY-MM-DD' → '1990年4月12日' */
function fmtDate(s) {
  var p = splitDate(s);
  return p.y ? p.y + '年' + p.m + '月' + p.d + '日' : '';
}

/** 'YYYY-MM-DD HH:mm:ss' → '2026/9/24 12:30' */
function fmtStamp(s) {
  var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
  if (!m) return s || '';
  return m[1] + '/' + (+m[2]) + '/' + (+m[3]) + (m[4] ? ' ' + m[4] + ':' + m[5] : '');
}

function ageOf(s) {
  var p = splitDate(s);
  if (!p.y) return '';
  var now = new Date(), a = now.getFullYear() - +p.y;
  if (now.getMonth() + 1 < +p.m || (now.getMonth() + 1 === +p.m && now.getDate() < +p.d)) a--;
  return a + '歳';
}

// ---------- 入力フォームの値 ↔ サーバーに送る形 ----------

var DATE_PARTS = [['birth', 'birth_date'], ['contract', 'contract_join_date'], ['regular', 'regular_join_date']];

var EMPTY_FORM = {
  employee_code: '', birth_y: '', birth_m: '', birth_d: '',
  sei: '', mei: '', sei_kana: '', mei_kana: '', gender: '', job_title: '',
  contract_y: '', contract_m: '', contract_d: '', regular_y: '', regular_m: '', regular_d: '',
  tel_home: '', tel_mobile: '', zip: '', address: '', family_zip: '', family_address: '', family_tel: '',
  station_home_line: '', station_home: '', station_family_line: '', station_family: '',
  kyosai_sogo: '', kyosai_kyuen: '', kotsu_seisaku: '', kyosai_kazoku: '',
  prev_workplace: '', officer_exp: '', officer_when: '', officer_detail: ''
};

var EMPTY_FAMILY = { sei: '', mei: '', sei_kana: '', mei_kana: '', y: '', m: '', d: '', gender: '', relationship: '', living_together: '' };

function clone(x) { return JSON.parse(JSON.stringify(x)); }

/** フォーム → サーバーに送る record */
function formToRecord(f) {
  var r = {};
  Object.keys(EMPTY_FORM).forEach(function (k) {
    if (!/_(y|m|d)$/.test(k)) r[k] = String(f[k] || '').trim();
  });
  DATE_PARTS.forEach(function (p) {
    var y = f[p[0] + '_y'], m = f[p[0] + '_m'], d = f[p[0] + '_d'];
    r[p[1]] = (y || m || d) ? (joinDate(y, m, d) || y + '-' + m + '-' + d) : '';
  });
  return r;
}

function familyToRecord(list) {
  return list.map(function (m) {
    return {
      sei: m.sei.trim(), mei: m.mei.trim(), sei_kana: m.sei_kana.trim(), mei_kana: m.mei_kana.trim(),
      birth_date: (m.y || m.m || m.d) ? (joinDate(m.y, m.m, m.d) || m.y + '-' + m.m + '-' + m.d) : '',
      gender: m.gender, relationship: m.relationship, living_together: m.living_together
    };
  });
}

/** サーバーの member → フォーム */
function recordToForm(rec) {
  var f = clone(EMPTY_FORM);
  Object.keys(f).forEach(function (k) { if (rec[k] != null) f[k] = String(rec[k]); });
  DATE_PARTS.forEach(function (p) {
    var d = splitDate(rec[p[1]]);
    f[p[0] + '_y'] = d.y; f[p[0] + '_m'] = d.m; f[p[0] + '_d'] = d.d;
  });
  return f;
}

function recordToFamily(list) {
  return (list || []).map(function (r) {
    var d = splitDate(r.birth_date);
    return { sei: r.sei || '', mei: r.mei || '', sei_kana: r.sei_kana || '', mei_kana: r.mei_kana || '',
             y: d.y, m: d.m, d: d.d, gender: r.gender || '', relationship: r.relationship || '',
             living_together: r.living_together || '' };
  });
}

// ---------- 画面側のチェック（本番のチェックは GAS 側） ----------

var KANA_RE = /^[ァ-ヶー・]+$/;
var TEL_RE = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;
var ZIP_RE = /^\d{3}-\d{4}$/;

function validateForm(f, fam) {
  var e = {};
  var telOk = function (v) { var n = v.replace(/\D/g, '').length; return TEL_RE.test(v) && n >= 10 && n <= 11; };
  if (!/^\d{7}$/.test(f.employee_code)) e.employee_code = '7桁の半角数字で入力してください';
  if (validDate(f.birth_y, f.birth_m, f.birth_d) !== true) e.birth = '正しい生年月日を入力してください';
  if (!f.sei.trim() || !f.mei.trim()) e.name = '姓と名を入力してください';
  if (!f.sei_kana.trim() || !f.mei_kana.trim()) e.kana = 'セイとメイを入力してください';
  else if (!KANA_RE.test(f.sei_kana) || !KANA_RE.test(f.mei_kana)) e.kana = '全角カタカナで入力してください';
  if (!f.gender) e.gender = '性別を選んでください';
  if (!f.job_title.trim()) e.job_title = '職名を入力してください';
  if (validDate(f.contract_y, f.contract_m, f.contract_d) === false) e.contract = '日付が正しくありません';
  if (validDate(f.regular_y, f.regular_m, f.regular_d) === false) e.regular = '日付が正しくありません';
  if (!f.tel_mobile) e.tel_mobile = '携帯番号を入力してください';
  else if (!telOk(f.tel_mobile)) e.tel_mobile = '電話番号の形式が正しくありません';
  if (f.tel_home && !telOk(f.tel_home)) e.tel_home = '電話番号の形式が正しくありません';
  if (f.family_tel && !telOk(f.family_tel)) e.family_tel = '電話番号の形式が正しくありません';
  if (!f.zip) e.zip = '郵便番号を入力してください';
  else if (!ZIP_RE.test(f.zip)) e.zip = '郵便番号は7桁です';
  if (f.family_zip && !ZIP_RE.test(f.family_zip)) e.family_zip = '郵便番号は7桁です';
  if (!f.address.trim()) e.address = '住所を入力してください';
  if (!f.station_home_line.trim() || !f.station_home.trim()) e.station = '自宅の最寄駅（線と駅）を入力してください';
  if (!f.kyosai_sogo || !f.kyosai_kyuen || !f.kyosai_kazoku || !f.kotsu_seisaku) e.kyosai = '4つすべて選んでください';
  if (!f.officer_exp) e.officer = '無・有を選んでください';
  else if (f.officer_exp === '有' && (!f.officer_when || !f.officer_detail.trim())) e.officer = '以前・現在と、所属箇所と役職を入力してください';
  fam.forEach(function (m, i) {
    if (!m.sei.trim() || !m.mei.trim() || !m.sei_kana.trim() || !m.mei_kana.trim()) e['fam' + i] = '氏名（姓・名）とフリガナを入力してください';
    else if (!KANA_RE.test(m.sei_kana) || !KANA_RE.test(m.mei_kana)) e['fam' + i] = 'フリガナは全角カタカナで入力してください';
    else if (validDate(m.y, m.m, m.d) === false) e['fam' + i] = '生年月日が正しくありません';
    else if (!m.relationship) e['fam' + i] = '続柄を選んでください';
  });
  return e;
}

/** サーバーから返ってきた項目別エラー → 画面のエラーのキー */
function serverErrors(errors) {
  var map = { birth_date: 'birth', sei: 'name', mei: 'name', sei_kana: 'kana', mei_kana: 'kana',
              contract_join_date: 'contract', regular_join_date: 'regular',
              station_home_line: 'station', station_home: 'station',
              kyosai_sogo: 'kyosai', kyosai_kyuen: 'kyosai', kotsu_seisaku: 'kyosai', kyosai_kazoku: 'kyosai',
              officer_exp: 'officer', officer_when: 'officer', officer_detail: 'officer' };
  var e = {};
  Object.keys(errors || {}).forEach(function (k) {
    var m = k.match(/^family\.(\d+)\./);
    var key = m ? 'fam' + m[1] : (map[k] || k);
    if (!e[key]) e[key] = errors[k];
  });
  return e;
}

// ---------- ちょっとした表示 ----------

var toastTimer = null;

/** 画面下に一言メッセージ（kind: ok / err） */
function toast(msg, kind) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast-fixed ' + (kind === 'err' ? 'err' : 'ok') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.className = 'toast-fixed'; }, kind === 'err' ? 6000 : 3500);
}

/** 通信中の表示 */
var busyCount = 0;
function setBusy(on) {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  document.getElementById('busy').className = busyCount ? 'busy show' : 'busy';
}

/** ボタンを押している間は二度押しできないようにして、API を呼ぶ */
function withBusy(btn, promise) {
  if (btn) btn.disabled = true;
  setBusy(true);
  return promise.then(function (r) {
    setBusy(false);
    if (btn) btn.disabled = false;
    return r;
  }, function (e) {
    setBusy(false);
    if (btn) btn.disabled = false;
    throw e;
  });
}

function isWide() {
  return window.matchMedia('(min-width: 900px)').matches;
}
