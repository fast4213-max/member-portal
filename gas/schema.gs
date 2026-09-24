/**
 * schema.gs — シートの列・入力項目の定義と、入力値の整形・検証
 *
 * 入力検証はここ（GAS側）が本体。画面側のチェックは使いやすさのためだけ。
 */

// 固定値（台帳に表示するだけ）
var HONBU = '大阪地方本部';
var BRANCH = '天王寺支部';
var BUNKAI = '天王寺車掌区分会';

var FAMILY_MAX = 10;               // 紙の台帳の枠が10人分
var KYOSAI_CHOICES = ['加入済', '未加入', '不明'];

// 各シートの列（1行目の見出し）。並び順を変えるときはシートの見出しも同じ順にすること
var SHEETS = {
  members: [
    'member_id', 'honbu', 'branch', 'bunkai',
    'sei', 'mei', 'sei_kana', 'mei_kana', 'gender', 'birth_date', 'job_title',
    'contract_join_date', 'regular_join_date', 'tel_home', 'tel_mobile',
    'zip', 'address', 'family_zip', 'family_address', 'family_tel',
    'employee_code', 'station_home_line', 'station_home', 'station_family_line', 'station_family',
    'kyosai_sogo', 'kyosai_kyuen', 'kotsu_seisaku', 'kyosai_kazoku',
    'prev_workplace', 'officer_exp', 'officer_when', 'officer_detail',
    'created_at', 'updated_at', 'updated_by', 'deleted', 'deleted_at', 'deleted_by'
  ],
  family: [
    'family_id', 'member_id', 'sei', 'mei', 'sei_kana', 'mei_kana',
    'birth_date', 'gender', 'relationship', 'living_together', 'deleted'
  ],
  change_requests: [
    'request_id', 'type', 'member_id', 'requested_at', 'requester_key',
    'before_json', 'after_json', 'base_updated_at', 'status', 'superseded_by',
    'reviewed_by', 'reviewed_at', 'reject_reason', 'notified'
  ],
  members_history: [
    'history_id', 'member_id', 'changed_at', 'changed_by', 'reason', 'snapshot_json'
  ],
  audit_log: [
    'timestamp', 'role', 'actor', 'action', 'target_id', 'detail'
  ]
};

function field_(id, label, kind, req, opt) {
  var f = { id: id, label: label, kind: kind, req: !!req };
  if (Array.isArray(opt)) f.choices = opt; else if (opt) f.max = opt;
  return f;
}

// 本人の入力項目（紙の台帳の並び）
var MEMBER_FIELDS = [
  field_('sei', '氏名（姓）', 'text', true, 20),
  field_('mei', '氏名（名）', 'text', true, 20),
  field_('sei_kana', 'フリガナ（セイ）', 'kana', true, 30),
  field_('mei_kana', 'フリガナ（メイ）', 'kana', true, 30),
  field_('gender', '性別', 'choice', true, ['男', '女']),
  field_('birth_date', '生年月日', 'date', true),
  field_('job_title', '職名', 'text', true, 30),
  field_('contract_join_date', '契約社員入社年月日', 'date', false),
  field_('regular_join_date', '正社員入社年月日', 'date', false),
  field_('tel_home', '電話（自宅）', 'tel', false),
  field_('tel_mobile', '電話（携帯）', 'tel', true),
  field_('zip', '現住所 〒', 'zip', true),
  field_('address', '現住所', 'text', true, 100),
  field_('family_zip', '実家住所 〒', 'zip', false),
  field_('family_address', '実家住所', 'text', false, 100),
  field_('family_tel', '実家電話', 'tel', false),
  field_('employee_code', '社員番号', 'code', true),
  field_('station_home_line', '最寄駅 自宅（線）', 'text', true, 30),
  field_('station_home', '最寄駅 自宅（駅）', 'text', true, 30),
  field_('station_family_line', '最寄駅 実家（線）', 'text', false, 30),
  field_('station_family', '最寄駅 実家（駅）', 'text', false, 30),
  field_('kyosai_sogo', '総合共済', 'choice', true, KYOSAI_CHOICES),
  field_('kyosai_kyuen', '救援共済', 'choice', true, KYOSAI_CHOICES),
  field_('kotsu_seisaku', '交通政策をすすめる会', 'choice', true, KYOSAI_CHOICES),
  field_('kyosai_kazoku', '家族支援共済', 'choice', true, KYOSAI_CHOICES),
  field_('prev_workplace', '前職場', 'text', false, 50),
  field_('officer_exp', '組合役員経験', 'choice', true, ['無', '有']),
  field_('officer_when', '組合役員経験（以前／現在）', 'choice', false, ['以前', '現在']),
  field_('officer_detail', '組合役員経験（所属箇所と役職）', 'text', false, 100)
];

// 家族の入力項目
var FAMILY_FIELDS = [
  field_('sei', '氏名（姓）', 'text', true, 20),
  field_('mei', '氏名（名）', 'text', true, 20),
  field_('sei_kana', 'フリガナ（セイ）', 'kana', true, 30),
  field_('mei_kana', 'フリガナ（メイ）', 'kana', true, 30),
  field_('birth_date', '生年月日', 'date', false),
  field_('gender', '性別', 'choice', false, ['男', '女']),
  field_('relationship', '続柄', 'choice', true, ['妻', '夫', '子', '父', '母', '義父', '義母', 'その他']),
  field_('living_together', '同居・別居', 'choice', false, ['同居', '別居'])
];

var KANA_RE = /^[ァ-ヶー・]+$/;
var TEL_RE = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

/** 全角数字・全角ハイフン類を半角にする */
function toHalf_(s) {
  return String(s)
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
    .replace(/[－ー―‐−]/g, '-');
}

/** ひらがな→カタカナ、空白は取り除く */
function toKana_(s) {
  return String(s)
    .replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); })
    .replace(/[\s　]/g, '');
}

/** 制御文字を取り除いて前後の空白を削る */
function cleanText_(s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
}

/**
 * 日付を 'YYYY-MM-DD' に揃える。月日は 1 でも 01 でも可。
 * 空なら ''、正しくなければ null を返す。
 */
function normDate_(v) {
  var s = toHalf_(cleanText_(v));
  if (!s) return '';
  var m = s.match(/^(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})日?$/);
  if (!m) return null;
  var y = +m[1], mo = +m[2], d = +m[3];
  var dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  if (y < 1900 || dt > new Date()) return null;
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

/** 1項目を整形・検証する。戻り値 { v: 値, err: エラー文 or '' } */
function normField_(f, raw) {
  var s = cleanText_(raw), v = s;
  switch (f.kind) {
    case 'text':
      v = s.replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
      if (v.length > f.max) return { v: v, err: f.max + '文字以内で入力してください' };
      break;
    case 'kana':
      v = toKana_(s);
      if (v && !KANA_RE.test(v)) return { v: v, err: '全角カタカナで入力してください' };
      if (v.length > f.max) return { v: v, err: f.max + '文字以内で入力してください' };
      break;
    case 'date':
      v = normDate_(s);
      if (v === null) return { v: s, err: '正しい日付を入力してください' };
      break;
    case 'tel':
      v = toHalf_(s).replace(/[\s()（）]/g, '');
      if (v && (!TEL_RE.test(v) || v.replace(/\D/g, '').length < 10 || v.replace(/\D/g, '').length > 11)) {
        return { v: v, err: '電話番号の形式が正しくありません' };
      }
      break;
    case 'zip':
      var dz = toHalf_(s).replace(/\D/g, '');
      if (dz && dz.length !== 7) return { v: s, err: '郵便番号は7桁です' };
      v = dz ? dz.slice(0, 3) + '-' + dz.slice(3) : '';
      break;
    case 'code':
      v = toHalf_(s).replace(/\s/g, '');
      if (v && !/^\d{7}$/.test(v)) return { v: v, err: '7桁の半角数字で入力してください' };
      break;
    case 'choice':
      if (v && f.choices.indexOf(v) < 0) return { v: v, err: '選択肢から選んでください' };
      break;
  }
  if (f.req && !v) return { v: v, err: f.label + 'を入力してください' };
  return { v: v, err: '' };
}

/**
 * 画面から来た本人の内容と家族を整形・検証する。
 * 問題があれば invalid エラー（項目ごとのエラー文付き）を投げる。
 */
function normalizeRecord_(rawMember, rawFamily) {
  var errors = {}, member = {}, family = [];
  rawMember = rawMember && typeof rawMember === 'object' ? rawMember : {};

  MEMBER_FIELDS.forEach(function (f) {
    var r = normField_(f, rawMember[f.id]);
    member[f.id] = r.v;
    if (r.err) errors[f.id] = r.err;
  });
  if (member.officer_exp === '有') {
    if (!member.officer_when) errors.officer_when = '以前・現在を選んでください';
    if (!member.officer_detail) errors.officer_detail = '所属箇所と役職を入力してください';
  } else {
    member.officer_when = '';
    member.officer_detail = '';
  }

  if (rawFamily != null && !Array.isArray(rawFamily)) rawFamily = [];
  (rawFamily || []).forEach(function (rf, i) {
    rf = rf && typeof rf === 'object' ? rf : {};
    var fm = {};
    FAMILY_FIELDS.forEach(function (f) {
      var r = normField_(f, rf[f.id]);
      fm[f.id] = r.v;
      if (r.err) errors['family.' + i + '.' + f.id] = r.err;
    });
    family.push(fm);
  });
  if (family.length > FAMILY_MAX) errors.family = '家族は' + FAMILY_MAX + '人までです';

  if (Object.keys(errors).length) fail_('invalid', '入力内容を確認してください', { errors: errors });
  return { member: member, family: family };
}

/** 本人確認用：社員番号と生年月日を整形。形式が違えば invalid */
function normIdentity_(code, birth) {
  var c = normField_(MEMBER_FIELDS.filter(function (f) { return f.id === 'employee_code'; })[0], code);
  var b = normDate_(birth);
  var errors = {};
  if (c.err || !c.v) errors.employee_code = '7桁の半角数字で入力してください';
  if (!b) errors.birth_date = '正しい生年月日を入力してください';
  if (Object.keys(errors).length) fail_('invalid', '社員番号と生年月日を確認してください', { errors: errors });
  return { code: c.v, birth: b };
}

/** 変更のあった本人項目のID一覧 */
function changedFields_(before, after) {
  return MEMBER_FIELDS.filter(function (f) {
    return String(before[f.id] || '') !== String(after[f.id] || '');
  }).map(function (f) { return f.id; });
}

/** 家族に変更があるか */
function familyChanged_(beforeFam, afterFam) {
  var pick = function (list) {
    return JSON.stringify((list || []).map(function (m) {
      return FAMILY_FIELDS.map(function (f) { return String(m[f.id] || ''); });
    }));
  };
  return pick(beforeFam) !== pick(afterFam);
}

/** 変更項目名（ログ用・値は含めない） */
function changedLabels_(fieldIds, famChanged) {
  var labels = fieldIds.map(function (id) {
    return MEMBER_FIELDS.filter(function (f) { return f.id === id; })[0].label;
  });
  if (famChanged) labels.push('家族構成');
  return labels.join('、');
}

/** 生年月日 'YYYY-MM-DD' から年齢 */
function ageOf_(birth) {
  var m = String(birth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var now = new Date(), a = now.getFullYear() - +m[1];
  if (now.getMonth() + 1 < +m[2] || (now.getMonth() + 1 === +m[2] && now.getDate() < +m[3])) a--;
  return a;
}

// フリガナ（セイ）の先頭文字 → 行
var KANA_ROWS = {
  a: 'アイウエオヴァィゥェォ', ka: 'カキクケコガギグゲゴ', sa: 'サシスセソザジズゼゾ',
  ta: 'タチツテトダヂヅデドッ', na: 'ナニヌネノ', ha: 'ハヒフヘホバビブベボパピプペポ',
  ma: 'マミムメモ', ya: 'ヤユヨャュョ', ra: 'ラリルレロ', wa: 'ワヲンヮ'
};
