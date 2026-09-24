/*
 * ledger.js — 台帳の表示
 *   buildSheet()    … 紙の台帳と同じ見た目（A4・印刷用）
 *   buildReadable() … 項目を縦に並べた読みやすい表示（スマホ向け）
 * どちらも rec（本人）・fam（家族）はサーバーと同じ形（日付は 'YYYY-MM-DD'）。
 * base / baseFam を渡すと、変わった所を黄色にする。
 */
'use strict';

var SHEET_W = 794, SHEET_H = 1123;   // A4（96dpi）

var HL_GROUPS = {
  kana: ['sei_kana', 'mei_kana'], name: ['sei', 'mei'], gender: ['gender'], birth: ['birth_date'],
  job: ['job_title'], contract: ['contract_join_date'], regular: ['regular_join_date'],
  tel: ['tel_home', 'tel_mobile'], addr: ['zip', 'address'], faddr: ['family_zip', 'family_address'],
  ftel: ['family_tel'], code: ['employee_code'],
  st: ['station_home_line', 'station_home', 'station_family_line', 'station_family'],
  prev: ['prev_workplace'], off: ['officer_exp', 'officer_when', 'officer_detail'],
  kyosai_sogo: ['kyosai_sogo'], kyosai_kyuen: ['kyosai_kyuen'], kotsu_seisaku: ['kotsu_seisaku'], kyosai_kazoku: ['kyosai_kazoku']
};

var KYOSAI_ITEMS = [['kyosai_sogo', '総合共済'], ['kyosai_kyuen', '救援共済'], ['kotsu_seisaku', '交通政策をすすめる会'], ['kyosai_kazoku', '家族支援共済']];

function highlights_(rec, base) {
  var hl = {};
  Object.keys(HL_GROUPS).forEach(function (g) {
    hl[g] = !!base && HL_GROUPS[g].some(function (k) { return String(rec[k] || '') !== String(base[k] || ''); });
  });
  return hl;
}

function famKey_(m) {
  return m ? [m.sei, m.mei, m.sei_kana, m.mei_kana, m.birth_date, m.gender, m.relationship, m.living_together].join('|') : '';
}

function famHl_(fam, baseFam, i) {
  return !!baseFam && famKey_(fam[i]) !== famKey_(baseFam[i]);
}

function nm_(r) { return [r.sei, r.mei].filter(Boolean).join(' '); }
function kn_(r) { return [r.sei_kana, r.mei_kana].filter(Boolean).join(' '); }

/** セル */
function c_(cls, style) {
  var kids = Array.prototype.slice.call(arguments, 2);
  return h.apply(null, ['div', { class: 'c ' + (cls || ''), style: style || '' }].concat(kids));
}
function v_(text, style) { return h('span', { class: 'lv', style: style || '' }, text || ''); }
function mk_(label, on) { return h('span', { class: 'mk' + (on ? ' on' : '') }, label); }

/**
 * 紙と同じ見た目の台帳（794×1123 の要素）
 * opts: { rec, fam, base, baseFam, madeAt }
 */
function buildSheet(opts) {
  var r = opts.rec, fam = opts.fam || [], hl = highlights_(r, opts.base);
  var H = function (g) { return hl[g] ? 'hl' : ''; };
  var made = String(opts.madeAt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  var madeY = made ? made[1] : '', madeM = made ? String(+made[2]) : '', madeD = made ? String(+made[3]) : '';

  var top = h('div', { class: 'g', style: 'grid-template-columns:66px minmax(0,1fr) 42px 50px 126px 84px 128px' },
    c_('lab', 'height:26px', 'フリガナ'),
    c_('lv ' + H('kana'), 'font-size:12px;letter-spacing:.08em', kn_(r)),
    c_('lab', '', '性別'), c_('lab', '', '年齢'), c_('lab', '', '生年月日'), c_('lab', '', '職名'),
    c_('lab', 'font-size:10px;letter-spacing:0', '契約社員入社年月日'),

    c_('lab', 'height:52px', '氏　名'),
    c_('lv ' + H('name'), 'font-size:22px;font-weight:700;letter-spacing:.08em', nm_(r)),
    c_('lv ' + H('gender'), 'justify-content:center', r.gender || ''),
    c_('lv ' + H('birth'), 'justify-content:center', ageOf(r.birth_date)),
    c_('lv ' + H('birth'), 'justify-content:center', fmtDate(r.birth_date)),
    c_('lv ' + H('job'), 'justify-content:center;text-align:center', r.job_title || ''),
    c_('lv ' + H('contract'), 'justify-content:center', fmtDate(r.contract_join_date)),

    c_('lab', 'height:36px', '電話番号'),
    c_(H('tel'), 'grid-column:2/7;gap:10px',
       h('span', { style: 'font-size:11px' }, '自宅'), v_(r.tel_home, 'width:170px'),
       h('span', { style: 'font-size:11px' }, '携帯'), v_(r.tel_mobile)),
    c_('lab', 'font-size:10px;letter-spacing:0', '正社員入社年月日'),

    c_('lab', 'height:56px', '現住所'),
    c_(H('addr'), 'grid-column:2/7;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px',
       h('span', { style: 'font-size:11px' }, '〒 ', v_(r.zip)), v_(r.address, 'font-size:13px')),
    c_('lv ' + H('regular'), 'justify-content:center', fmtDate(r.regular_join_date)),

    c_('lab', 'height:56px', '実家住所'),
    c_(H('faddr'), 'grid-column:2/6;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px',
       h('span', { style: 'font-size:11px' }, '〒 ', v_(r.family_zip)), v_(r.family_address, 'font-size:13px')),
    c_(H('ftel'), 'grid-column:6/8;gap:8px', h('span', { style: 'font-size:11px' }, '電話'), v_(r.family_tel)),

    c_('lab', 'height:44px', '社員コード'),
    c_('lv ' + H('code'), 'font-size:14px;letter-spacing:.14em', r.employee_code || ''),
    c_('lab', 'grid-column:3/5', '最寄駅'),
    c_(H('st'), 'grid-column:5/8;gap:6px;font-size:11.5px;flex-wrap:wrap',
       h('span', null, '自宅'), v_(r.station_home_line), h('span', null, '線'), v_(r.station_home), h('span', null, '駅'),
       h('span', { style: 'margin-left:10px' }, '実家'), v_(r.station_family_line), h('span', null, '線'), v_(r.station_family), h('span', null, '駅'))
  );

  var famGrid = h('div', { class: 'g', style: 'grid-template-columns:minmax(0,1fr) 84px 32px 38px 34px minmax(0,1fr) 84px 32px 38px 34px' },
    c_('lab', 'grid-column:1/11;height:28px;font-size:12.5px;letter-spacing:.6em', 'ご家族構成'));
  for (var k = 0; k < 2; k++) {
    ['氏　名', '生年月日', '性別', '続柄', '同別'].forEach(function (t, i) {
      famGrid.appendChild(c_('lab', i === 0 ? 'height:24px' : '', t));
    });
  }
  // 紙と同じく左列に1〜5人目、右列に6〜10人目
  for (var row = 0; row < 5; row++) {
    [row, row + 5].forEach(function (i) {
      var m = fam[i] || {}, cls = famHl_(fam, opts.baseFam, i) ? 'hl' : '';
      famGrid.appendChild(c_(cls, 'height:50px;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px',
        h('span', { style: 'font-size:9.5px' }, 'カナ ', v_(kn_(m), 'font-size:10px')), v_(nm_(m), 'font-size:13.5px')));
      famGrid.appendChild(c_('lv ' + cls, 'justify-content:center;font-size:10.5px;text-align:center', fmtDate(m.birth_date)));
      famGrid.appendChild(c_('lv ' + cls, 'justify-content:center', m.gender || ''));
      famGrid.appendChild(c_('lv ' + cls, 'justify-content:center', m.relationship || ''));
      famGrid.appendChild(c_('lv ' + cls, 'justify-content:center', (m.living_together || '').charAt(0)));
    });
  }

  var kyosai = h('div', { class: 'g', style: 'grid-template-columns:110px minmax(0,1fr) 150px minmax(0,1fr)' },
    KYOSAI_ITEMS.map(function (it) {
      var v = r[it[0]];
      return [c_('lab', 'height:40px', it[1]),
              c_(H(it[0]), 'justify-content:center;gap:2px;font-size:12px',
                 mk_('加入済', v === '加入済'), '・', mk_('未加入', v === '未加入'), '・', mk_('不明', v === '不明'))];
    }));

  var bottom = h('div', { class: 'g', style: 'grid-template-columns:110px minmax(0,1fr)' },
    c_('lab', 'height:44px', '前職場'), c_('lv ' + H('prev'), '', r.prev_workplace || ''),
    c_('lab', 'height:56px', '組合役員経験'),
    c_(H('off'), 'gap:4px;font-size:12px;flex-wrap:wrap',
       mk_('無', r.officer_exp === '無'), '・', mk_('有', r.officer_exp === '有'),
       h('span', { style: 'margin:0 4px' }, '→'),
       mk_('以前', r.officer_when === '以前'), '・', mk_('現在', r.officer_when === '現在'),
       h('span', { style: 'margin-left:8px' }, '（所属箇所と役職）'), v_(r.officer_detail, 'font-size:13px')));

  return h('div', { class: 'sheet' },
    h('div', { style: 'text-align:center;font-size:19px;font-weight:700;letter-spacing:.06em' }, '西日本旅客鉄道労働組合（JR西労組）組合員台帳'),
    h('div', { style: 'display:flex;justify-content:space-between;font-size:12.5px' },
      h('div', { style: 'letter-spacing:.06em' }, HONBU_BRANCH_BUNKAI),
      h('div', null, v_(madeY), ' 年 ', v_(madeM), ' 月 ', v_(madeD), ' 日 作成')),
    top, famGrid, kyosai, bottom);
}

var HONBU_BRANCH_BUNKAI = '大阪地方本部　天王寺支部　天王寺車掌区分会';

/**
 * 台帳を幅に合わせて縮小表示する入れ物。zoomed=true なら原寸（横スクロール）
 */
function sheetHost(sheet, zoomed) {
  var inner = h('div', { style: 'overflow:hidden' }, sheet);
  var host = h('div', { class: 'sheet-host' }, inner);
  var fit = function () {
    var w = host.clientWidth || SHEET_W;
    var s = zoomed ? 1 : Math.min(1, w / SHEET_W);
    sheet.style.transform = 'scale(' + s + ')';
    inner.style.width = Math.round(SHEET_W * s) + 'px';
    inner.style.height = Math.round(SHEET_H * s) + 'px';
  };
  if (window.ResizeObserver) new ResizeObserver(fit).observe(host);
  requestAnimationFrame(fit);
  return host;
}

/** 読みやすい表示（縦並び） */
function buildReadable(opts) {
  var r = opts.rec, fam = opts.fam || [], hl = highlights_(r, opts.base);
  var row = function (label, value, g) {
    return h('div', { class: 'rd-row' + (g && hl[g] ? ' hl' : '') },
      h('div', { class: 'rd-k' }, label), h('div', { class: 'rd-v' }, value || '—'));
  };
  var sec = function (title, rows) {
    return h('section', { class: 'sec rd-sec' }, h('h3', { class: 'st rd-t' }, title), rows);
  };
  var join = function () { return Array.prototype.filter.call(arguments, Boolean).join(' '); };

  var famRows = fam.length ? fam.map(function (m, i) {
    return h('div', { class: 'rd-row' + (famHl_(fam, opts.baseFam, i) ? ' hl' : '') },
      h('div', { class: 'rd-k' }, (m.relationship || '家族') + (m.living_together ? '（' + m.living_together + '）' : '')),
      h('div', { class: 'rd-v' }, nm_(m) + (kn_(m) ? '（' + kn_(m) + '）' : '') +
        (m.birth_date || m.gender ? '\n' + join(fmtDate(m.birth_date), m.gender) : '')));
  }) : [row('家族', '登録なし')];
  if (opts.baseFam && opts.baseFam.length > fam.length) {
    famRows.push(h('div', { class: 'rd-row hl' }, h('div', { class: 'rd-k' }, '削除'),
      h('div', { class: 'rd-v' }, (opts.baseFam.length - fam.length) + '人を削除')));
  }

  return h('div', { class: 'rd' },
    h('div', { class: 'rd-head' },
      h('div', { class: 'rd-org' }, HONBU_BRANCH_BUNKAI),
      h('div', { class: 'h rd-name' }, nm_(r)),
      h('div', { class: 'num-t rd-sub' }, kn_(r) + '・社員番号 ' + (r.employee_code || ''))),
    sec('基本情報', [
      row('氏名', nm_(r), 'name'), row('フリガナ', kn_(r), 'kana'), row('性別', r.gender, 'gender'),
      row('生年月日', r.birth_date ? fmtDate(r.birth_date) + '（' + ageOf(r.birth_date) + '）' : '', 'birth'),
      row('職名', r.job_title, 'job'), row('契約社員入社', fmtDate(r.contract_join_date), 'contract'),
      row('正社員入社', fmtDate(r.regular_join_date), 'regular'), row('社員番号', r.employee_code, 'code')]),
    sec('電話・住所', [
      row('携帯', r.tel_mobile, 'tel'), row('自宅電話', r.tel_home, 'tel'),
      row('現住所', r.zip ? '〒' + r.zip + '\n' + (r.address || '') : r.address, 'addr'),
      row('実家住所', r.family_zip ? '〒' + r.family_zip + '\n' + (r.family_address || '') : r.family_address, 'faddr'),
      row('実家電話', r.family_tel, 'ftel')]),
    sec('最寄駅', [
      row('自宅', r.station_home ? join(r.station_home_line && r.station_home_line + '線', r.station_home + '駅') : '', 'st'),
      row('実家', r.station_family ? join(r.station_family_line && r.station_family_line + '線', r.station_family + '駅') : '', 'st')]),
    sec('ご家族構成（' + fam.length + '人）', famRows),
    sec('共済加入状況', KYOSAI_ITEMS.map(function (it) { return row(it[1], r[it[0]], it[0]); })),
    sec('前職場・組合役員経験', [
      row('前職場', r.prev_workplace, 'prev'),
      row('組合役員経験', r.officer_exp === '有' ? '有（' + (r.officer_when || '') + '）\n' + (r.officer_detail || '') : r.officer_exp, 'off')])
  );
}

/**
 * 表示切り替え付きの台帳（スマホ：読みやすい表示／台帳の形、PC：台帳の形）
 * state: { view: 'list'|'sheet', zoom: bool } を持ち回す。onChange で再描画
 */
function ledgerView(opts, state, onChange) {
  var wide = isWide();
  var showSheet = wide || state.view === 'sheet';
  var box = h('div', { class: 'ledger-box' });
  if (!wide) {
    box.appendChild(h('div', { class: 'seg seg-toggle noprint', role: 'group', 'aria-label': '表示の切り替え' },
      h('button', { type: 'button', class: 'sg' + (showSheet ? '' : ' on'), 'aria-pressed': String(!showSheet),
                    onClick: function () { state.view = 'list'; onChange(); } }, '読みやすい表示'),
      h('button', { type: 'button', class: 'sg' + (showSheet ? ' on' : ''), 'aria-pressed': String(showSheet),
                    onClick: function () { state.view = 'sheet'; onChange(); } }, '台帳の形')));
    if (showSheet) {
      box.appendChild(h('div', { class: 'noprint', style: 'display:flex;align-items:center;justify-content:space-between;gap:8px' },
        h('span', { style: 'font-size:12px;color:#5A6475' }, state.zoom ? '横にスクロールして見られます' : '紙と同じ見た目を縮小して表示しています'),
        h('button', { type: 'button', class: 'zoom', onClick: function () { state.zoom = !state.zoom; onChange(); } },
          ico('zoom', 15), state.zoom ? '画面に合わせる' : '拡大して見る')));
    }
  }
  // 印刷用に、読みやすい表示のときも台帳の形は（画面には出さずに）作っておく
  var host = sheetHost(buildSheet(opts), !wide && state.zoom);
  if (!showSheet) host.classList.add('print-only');
  if (!showSheet) box.appendChild(buildReadable(opts));
  box.appendChild(host);
  return box;
}
