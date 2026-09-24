/*
 * member.js — 組合員の画面（メニュー・新規・本人確認・更新・確認・完了）
 */
'use strict';

var M;

function resetMember() {
  M = {
    mode: 'new',             // 'new' | 'update' | 'edit'（edit は役員の直接編集）
    f: clone(EMPTY_FORM),
    fam: [],
    base: null, baseFam: null,   // 更新：いまの台帳（変更箇所の黄色表示に使う）
    idState: 'idle',         // 新規の本人確認：idle / checking / dupe / ok
    checked: '',             // 照会済みの 社員番号|生年月日
    v: { code: '', y: '', m: '', d: '' },   // 更新の本人確認
    vErr: '',
    auth: null,              // 更新：本人確認に使った社員番号・生年月日
    myReqs: [],
    errs: {}, tried: false,
    lv: { view: 'list', zoom: false },
    done: null
  };
}
resetMember();

function enterMember() {
  resetMember();
  go('menu');
}

// ---------- 入力部品 ----------

// エラー表示は欄から離れるたびに描き直さず、その場で書き換える（入力中の欄やキーボードが閉じないように）
function errP(key) {
  var msg = M.tried && M.errs[key];
  return h('p', { class: 'er', 'data-err': key, hidden: !msg }, msg || '');
}

function bad(key) { return M.tried && M.errs[key] ? ' bad' : ''; }

function barMessage() {
  var n = Object.keys(M.errs).length;
  return M.tried && n ? ['入力内容を確認してください（' + n + 'か所）', '#B42318']
                      : ['入力が終わったら、確認画面で台帳の形で確かめられます', '#5A6475'];
}

function refreshErrors() {
  document.querySelectorAll('[data-err]').forEach(function (p) {
    var msg = M.tried && M.errs[p.getAttribute('data-err')];
    p.hidden = !msg;
    p.textContent = msg || '';
  });
  document.querySelectorAll('[data-errkey]').forEach(function (el) {
    el.classList.toggle('bad', !!(M.tried && M.errs[el.getAttribute('data-errkey')]));
  });
  var bar = document.getElementById('formbar-msg');
  if (bar) { var b = barMessage(); bar.textContent = b[0]; bar.style.color = b[1]; }
}

function afterEdit() {
  if (M.tried) { M.errs = validateForm(M.f, M.fam); refreshErrors(); }
}

/** 本人の項目の入力欄 */
function inp(name, opts) {
  opts = opts || {};
  return h('input', {
    class: 'in' + bad(opts.err || name), name: name, 'data-key': 'f.' + name, 'data-errkey': opts.err || name, value: M.f[name],
    placeholder: opts.ph || '', inputmode: opts.mode || null, autocomplete: 'off',
    'aria-label': opts.label || null, style: opts.style || null, maxlength: opts.max || 100,
    onInput: function (e) { M.f[name] = e.target.value; },
    onChange: function (e) {
      var v = cleanValue(name, e.target.value);
      M.f[name] = v;
      e.target.value = v;
      if (opts.after) opts.after(); else afterEdit();
    }
  });
}

function dateIn(prefix, errKey, label, ph, after) {
  var one = function (part, cls, p) {
    return inp(prefix + '_' + part, { err: errKey, mode: 'numeric', ph: p, label: label + 'の' + { y: '年', m: '月', d: '日' }[part], after: after, max: 4 });
  };
  var box = h('div', { class: 'date' },
    one('y', 'y', ph[0]), h('span', null, '年'), one('m', 'md', ph[1]), h('span', null, '月'), one('d', 'md', ph[2]), h('span', null, '日'));
  box.children[0].classList.add('y');
  box.children[2].classList.add('md');
  box.children[4].classList.add('md');
  return box;
}

/** ボタン型の選択肢 */
function seg(obj, key, choices, after) {
  return h('div', { class: 'seg' }, choices.map(function (c) {
    var on = obj[key] === c;
    return h('button', { type: 'button', class: 'sg' + (on ? ' on' : ''), 'aria-pressed': String(on),
      onClick: function () { obj[key] = on ? '' : c; if (after) after(); if (M.tried) M.errs = validateForm(M.f, M.fam); render(); } }, c);
  }));
}

function fld(label, req, kids) {
  return h('div', { class: 'fld' },
    h('span', { class: 'lb' }, label, req === true ? h('em', { class: 'req' }, '必須') : req ? h('em', { class: 'opt' }, req) : null),
    kids);
}

function section(num, title, kids, opt) {
  return h('section', { class: 'sec' },
    h('h3', { class: 'st' }, h('span', { class: 'num' }, num), title, opt ? h('em', { class: 'opt' }, opt) : null), kids);
}

function note(kind, icon, kids, style) {
  return h('div', { class: 'note ' + kind, style: style || '' }, icon ? ico(icon, 18, 'margin-top:1px') : null, h('div', { style: 'flex:1 1 auto;min-width:0' }, kids));
}

/** 郵便番号 → 住所（ZipCloud）。送るのは郵便番号だけ */
function zipLookup(zipKey, addrKey, btn) {
  var z = (M.f[zipKey] || '').replace(/\D/g, '');
  if (z.length !== 7) { toast('郵便番号を7桁で入力してください', 'err'); return; }
  btn.disabled = true;
  fetch('https://zipcloud.ibsnet.co.jp/api/search?zipcode=' + z).then(function (r) { return r.json(); }).then(function (j) {
    btn.disabled = false;
    var a = j && j.results && j.results[0];
    if (!a) { toast('住所が見つかりませんでした。直接入力してください', 'err'); return; }
    M.f[addrKey] = a.address1 + a.address2 + a.address3;
    render();
    toast('住所を入れました。番地・建物名を続けて入力してください');
  }, function () {
    btn.disabled = false;
    toast('住所を取得できませんでした。直接入力してください', 'err');
  });
}

// ---------- メニュー ----------

SCREENS.menu = {
  title: '組合員メニュー',
  view: function () {
    var card = function (icon, bg, color, title, sub, onClick) {
      return h('button', { type: 'button', class: 'card', onClick: onClick },
        h('div', { style: 'width:52px;height:52px;border-radius:14px;background:' + bg + ';color:' + color + ';display:flex;align-items:center;justify-content:center;flex-shrink:0' }, ico(icon, 26)),
        h('div', { style: 'flex-grow:1;display:flex;flex-direction:column;gap:4px' },
          h('div', { style: 'font-size:18px;font-weight:700' }, title),
          h('div', { style: 'font-size:13px;color:#5A6475;line-height:1.5' }, sub)),
        h('span', { style: 'color:#9AA3B2' }, ico('next', 20)));
    };
    var step = function (n, on, a, b) {
      return h('div', { class: 'step' }, h('div', { class: 'dot' + (on ? ' on' : '') }, n), a, h('br'), b);
    };
    return h('div', { class: 'wrap', style: 'gap:18px' },
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;padding-top:8px' },
        orgInfo().bunkai ? h('div', { style: 'font-size:13px;font-weight:600;color:#5A6475' }, orgInfo().bunkai) : null,
        h('h2', { class: 'ttl', style: 'font-size:26px' }, 'どちらの手続きですか？')),
      h('div', { class: 'cards' },
        card('personAdd', '#EEF1FC', '#1F3FBF', '新規登録', 'はじめて台帳に登録する方', function () {
          resetMember(); M.mode = 'new'; go('new');
        }),
        card('edit', '#E7F6F0', '#0F7B5F', '登録内容の更新', '住所・電話・家族などが変わった方。申請状況の確認もこちら', function () {
          resetMember(); M.mode = 'update'; go('verify');
        })),
      h('div', { class: 'sec', style: 'gap:14px' },
        h('div', { style: 'font-size:13px;font-weight:700;color:#2A3547' }, '反映までの流れ'),
        h('div', { class: 'steps' },
          step(1, true, '入力して', '申請'), h('div', { class: 'bar-l' }),
          step(2, false, '役員が', '内容を確認'), h('div', { class: 'bar-l' }),
          step(3, false, '承認されて', '台帳に反映'))));
  }
};

// ---------- 新規：社員番号と生年月日の照会 ----------

function checkIdentity() {
  var f = M.f;
  if (!/^\d{7}$/.test(f.employee_code) || validDate(f.birth_y, f.birth_m, f.birth_d) !== true) {
    if (M.idState !== 'idle') { M.idState = 'idle'; M.checked = ''; render(); } else afterEdit();
    return;
  }
  var birth = joinDate(f.birth_y, f.birth_m, f.birth_d), key = f.employee_code + '|' + birth;
  if (key === M.checked) { afterEdit(); return; }
  M.idState = 'checking';
  render();
  withBusy(null, Api.call('checkDuplicate', { employee_code: f.employee_code, birth_date: birth })).then(function (d) {
    M.checked = key;
    M.idState = d.registered ? 'dupe' : 'ok';
    render();
  }, function (err) {
    M.idState = 'idle';
    render();
    toast(err.message, 'err');
  });
}

function identitySection() {
  var st = M.idState, kids = [
    h('label', { class: 'fld' },
      h('span', { class: 'lb' }, '社員番号', h('em', { class: 'req' }, '必須')),
      inp('employee_code', { mode: 'numeric', ph: '7桁の数字', style: 'letter-spacing:.12em', after: checkIdentity, max: 10 })),
    errP('employee_code'),
    fld('生年月日（西暦）', true, dateIn('birth', 'birth', '生年月日', ['1990', '1', '1'], checkIdentity)),
    errP('birth')
  ];
  if (st === 'idle') kids.push(h('p', { style: 'margin:0;font-size:12.5px;color:#5A6475;line-height:1.6' }, '社員番号と生年月日を入れると、すでに登録されているかを自動で確認します。月・日は「1」でも「01」でもOK。'));
  if (st === 'checking') kids.push(note('blue', 'clock', '確認しています…'));
  if (st === 'dupe') {
    kids.push(h('div', { class: 'note orange', role: 'alert', style: 'flex-direction:column;gap:12px' },
      h('div', { style: 'display:flex;gap:10px' }, ico('alert', 20),
        h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
          h('div', { style: 'font-weight:700;font-size:15px' }, '登録済みです'),
          h('div', null, 'この社員番号と生年月日はすでに台帳にあります。変更がある場合は「登録内容の更新」から申請してください。'))),
      h('button', { type: 'button', class: 'btn warn', onClick: function () {
        var f = M.f;
        var v = { code: f.employee_code, y: f.birth_y, m: f.birth_m, d: f.birth_d };
        resetMember(); M.mode = 'update'; M.v = v; go('verify');
      } }, '登録内容の更新へ進む')));
  }
  if (st === 'ok') kids.push(note('green', 'check', '未登録です。続けて入力してください。', 'align-items:center;font-weight:600'));
  return h('section', { class: 'sec' }, h('h3', { class: 'st' }, h('span', { class: 'num' }, '0'), '社員番号と生年月日'), kids);
}

// ---------- 入力フォーム本体（新規・更新共通） ----------

function formSections() {
  var f = M.f;
  var zipRow = function (zk, ak, req) {
    return fld('郵便番号', req, [
      h('div', { style: 'display:flex;gap:8px' },
        inp(zk, { mode: 'numeric', ph: '0000000', label: '郵便番号', style: 'width:150px;flex-shrink:0;letter-spacing:.06em', max: 10 }),
        h('button', { type: 'button', class: 'btn sec', style: 'height:48px;font-size:14px;padding:0 14px',
          onClick: function (e) { zipLookup(zk, ak, e.currentTarget); } }, '住所を自動入力')),
      req ? h('span', { style: 'font-size:12px;color:#5A6475' }, '数字7桁だけでOK（ハイフンは自動で入ります）') : null]);
  };

  var famBoxes = M.fam.map(function (m, i) {
    var fin = function (k, ph, label, mode) {
      return h('input', { class: 'in', name: k, 'data-key': 'fam.' + i + '.' + k, value: m[k], placeholder: ph,
        'aria-label': label, autocomplete: 'off', inputmode: mode || null, maxlength: 30,
        onInput: function (e) { m[k] = e.target.value; },
        onChange: function (e) { var v = cleanValue(k, e.target.value); m[k] = v; e.target.value = v; afterEdit(); } });
    };
    var d = h('div', { class: 'date' },
      fin('y', '1992', '家族の生年月日の年', 'numeric'), h('span', null, '年'),
      fin('m', '1', '家族の生年月日の月', 'numeric'), h('span', null, '月'),
      fin('d', '1', '家族の生年月日の日', 'numeric'), h('span', null, '日'));
    d.children[0].classList.add('y'); d.children[2].classList.add('md'); d.children[4].classList.add('md');
    var rel = h('select', { class: 'in', 'aria-label': '続柄', 'data-key': 'fam.' + i + '.rel',
      onChange: function (e) { m.relationship = e.target.value; afterEdit(); } },
      h('option', { value: '' }, '選択'),
      ['妻', '夫', '子', '父', '母', '義父', '義母', 'その他'].map(function (r) { return h('option', { value: r }, r); }));
    rel.value = m.relationship;
    return h('div', { class: 'fam' },
      h('div', { style: 'display:flex;align-items:center;justify-content:space-between' },
        h('span', { style: 'font-size:14px;font-weight:700' }, '家族 ' + (i + 1)),
        h('button', { type: 'button', class: 'del', 'aria-label': '家族 ' + (i + 1) + ' を削除', onClick: function () {
          M.fam.splice(i, 1); if (M.tried) M.errs = validateForm(M.f, M.fam); render();
        } }, '削除')),
      fld('氏名', false, h('div', { class: 'row2' }, fin('sei', '姓', '家族の姓'), fin('mei', '名', '家族の名'))),
      fld('フリガナ', false, h('div', { class: 'row2' }, fin('sei_kana', 'セイ', '家族のセイ'), fin('mei_kana', 'メイ', '家族のメイ'))),
      fld('生年月日', false, d),
      h('div', { class: 'row2' },
        h('label', { class: 'fld' }, h('span', { class: 'lb' }, '続柄'), rel),
        fld('性別', false, seg(m, 'gender', ['男', '女']))),
      fld('同居・別居', false, seg(m, 'living_together', ['同居', '別居'])),
      errP('fam' + i));
  });

  var kyosai = [['kyosai_sogo', '総合共済'], ['kyosai_kyuen', '救援共済'], ['kotsu_seisaku', '交通政策をすすめる会'], ['kyosai_kazoku', '家族支援共済']];

  return [
    section('1', '基本情報', [
      fld('氏名', true, h('div', { class: 'row2' },
        inp('sei', { err: 'name', ph: '姓（山田）', label: '姓', max: 20 }), inp('mei', { err: 'name', ph: '名（太郎）', label: '名', max: 20 }))),
      errP('name'),
      fld('フリガナ', true, h('div', { class: 'row2' },
        inp('sei_kana', { err: 'kana', ph: 'セイ（ヤマダ）', label: 'セイ', max: 30 }), inp('mei_kana', { err: 'kana', ph: 'メイ（タロウ）', label: 'メイ', max: 30 }))),
      errP('kana'),
      fld('性別', true, seg(f, 'gender', ['男', '女'])),
      errP('gender'),
      h('label', { class: 'fld' }, h('span', { class: 'lb' }, '職名', h('em', { class: 'req' }, '必須')),
        inp('job_title', { ph: '例：〇〇', max: 30 })),
      errP('job_title'),
      fld('契約社員入社年月日', '該当者のみ', dateIn('contract', 'contract', '契約社員入社', ['2010', '4', '1'])),
      errP('contract'),
      fld('正社員入社年月日', '任意', dateIn('regular', 'regular', '正社員入社', ['2012', '4', '1'])),
      errP('regular')
    ]),
    section('2', '電話番号', [
      h('label', { class: 'fld' }, h('span', { class: 'lb' }, '携帯', h('em', { class: 'req' }, '必須')),
        inp('tel_mobile', { mode: 'tel', ph: '090-0000-0000', max: 13 })),
      errP('tel_mobile'),
      h('label', { class: 'fld' }, h('span', { class: 'lb' }, '自宅', h('em', { class: 'opt' }, '任意')),
        inp('tel_home', { mode: 'tel', ph: '06-0000-0000', max: 13 })),
      errP('tel_home')
    ]),
    section('3', '現住所', [
      zipRow('zip', 'address', true), errP('zip'),
      h('label', { class: 'fld' }, h('span', { class: 'lb' }, '住所', h('em', { class: 'req' }, '必須')),
        inp('address', { ph: '都道府県から建物名・部屋番号まで' })),
      errP('address')
    ]),
    section('4', '実家住所', [
      zipRow('family_zip', 'family_address', false), errP('family_zip'),
      h('label', { class: 'fld' }, h('span', { class: 'lb' }, '住所'), inp('family_address', { ph: '都道府県から' })),
      h('label', { class: 'fld' }, h('span', { class: 'lb' }, '電話'), inp('family_tel', { mode: 'tel', ph: '0000-00-0000', max: 13 })),
      errP('family_tel')
    ], '任意'),
    section('5', '最寄駅', [
      fld('自宅', true, h('div', { class: 'row2' },
        inp('station_home_line', { err: 'station', ph: '〇〇線', label: '自宅最寄駅の路線', max: 30 }),
        inp('station_home', { err: 'station', ph: '〇〇駅', label: '自宅最寄駅', max: 30 }))),
      errP('station'),
      fld('実家', '任意', h('div', { class: 'row2' },
        inp('station_family_line', { ph: '〇〇線', label: '実家最寄駅の路線', max: 30 }),
        inp('station_family', { ph: '〇〇駅', label: '実家最寄駅', max: 30 })))
    ]),
    h('section', { class: 'sec' },
      h('h3', { class: 'st' }, h('span', { class: 'num' }, '6'), 'ご家族構成',
        h('span', { style: "margin-left:auto;font-family:'IBM Plex Sans JP',sans-serif;font-size:13px;font-weight:600;color:#5A6475" }, M.fam.length + ' / 10人')),
      M.fam.length ? null : h('p', { style: 'margin:0;font-size:13px;color:#5A6475' }, '登録する家族がいない場合はそのまま次へ進んでください。'),
      famBoxes,
      M.fam.length < 10 ? h('button', { type: 'button', class: 'add', onClick: function () {
        var n = clone(EMPTY_FAMILY);
        n.sei = M.f.sei; n.sei_kana = M.f.sei_kana;   // 姓は本人と同じ値を最初から入れておく
        M.fam.push(n);
        render();
      } }, ico('plus', 18), '家族を追加') : null),
    section('7', '共済加入状況', [
      kyosai.map(function (k) { return fld(k[1], true, seg(f, k[0], ['加入済', '未加入', '不明'])); }),
      errP('kyosai')
    ]),
    section('8', '前職場', inp('prev_workplace', { ph: '例：〇〇', label: '前職場', max: 50 }), '任意'),
    section('9', '組合役員経験', [
      seg(f, 'officer_exp', ['無', '有'], function () { if (f.officer_exp !== '有') { f.officer_when = ''; f.officer_detail = ''; } }),
      f.officer_exp === '有' ? h('div', { style: 'display:flex;flex-direction:column;gap:14px;padding:14px;border-radius:12px;background:#F6F7FB' },
        fld('時期', false, seg(f, 'officer_when', ['以前', '現在'])),
        h('label', { class: 'fld' }, h('span', { class: 'lb' }, '所属箇所と役職'), inp('officer_detail', { ph: '例：〇〇分会 書記長' }))) : null,
      errP('officer')
    ])
  ];
}

function formBar() {
  var show = M.mode !== 'new' || M.idState === 'ok';
  if (!show) return null;
  var msg = barMessage();
  return h('div', { class: 'bbar' }, h('div', { class: 'bbar-in' },
    h('div', { id: 'formbar-msg', style: 'flex-grow:1;font-size:12.5px;line-height:1.4;color:' + msg[1] }, msg[0]),
    h('button', { type: 'button', class: 'btn pri', style: 'flex-shrink:0', onClick: function () {
      M.tried = true;
      M.errs = validateForm(M.f, M.fam);
      if (Object.keys(M.errs).length) { render(); scrollToError(); return; }
      M.lv = { view: 'list', zoom: false };
      go('confirm');
    } }, '確認へ進む')));
}

SCREENS['new'] = {
  title: '新規登録',
  back: function () { go('menu'); },
  view: function () {
    return h('div', { class: 'wrap' },
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;padding:0 4px' },
        h('h2', { class: 'ttl' }, '新規登録'),
        h('p', { class: 'lead' }, '紙の台帳と同じ順番で入力します。数字は半角で入力してください（全角は自動で半角に直します）。')),
      identitySection(),
      M.idState === 'ok' ? formSections() : null);
  },
  bar: formBar
};

// ---------- 更新：本人確認 ----------

SCREENS.verify = {
  title: '本人確認',
  back: function () { go('menu'); },
  view: function () {
    var v = M.v;
    var vin = function (k, cls, ph, label, max) {
      return h('input', { class: 'in ' + cls, 'data-key': 'v.' + k, value: v[k], placeholder: ph, inputmode: 'numeric',
        autocomplete: 'off', 'aria-label': label, maxlength: max,
        onInput: function (e) { v[k] = e.target.value; },
        onChange: function (e) { var c = cleanValue(k === 'code' ? 'code' : 'x_' + k, e.target.value); v[k] = c; e.target.value = c; } });
    };
    var submit = function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('button[type=submit]');
      ['code', 'y', 'm', 'd'].forEach(function (k) { v[k] = cleanValue(k === 'code' ? 'code' : 'x_' + k, v[k]); });
      if (!/^\d{7}$/.test(v.code) || validDate(v.y, v.m, v.d) !== true) {
        M.vErr = '社員番号（7桁）と生年月日を正しく入力してください';
        render();
        return;
      }
      var auth = { employee_code: v.code, birth_date: joinDate(v.y, v.m, v.d) };
      withBusy(btn, Api.call('identify', auth).then(function (d) {
        if (d.requests) { d.reqs = d.requests; return d; }   // GAS 0.3.2 以降は identify が申請の状況も返す
        return Api.call('myRequests', auth).then(function (r) { d.reqs = r.items; return d; }, function () { d.reqs = []; return d; });
      })).then(function (d) {
        M.auth = auth;
        M.base = d.member;
        M.baseFam = d.family;
        M.f = recordToForm(d.member);
        M.fam = recordToFamily(d.family);
        M.myReqs = d.reqs || [];
        M.vErr = '';
        M.errs = {}; M.tried = false;
        go('update');
      }, function (err) {
        M.vErr = err.message;
        render();
      });
    };
    return h('div', { class: 'wrap', style: 'max-width:520px;gap:18px' },
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('h2', { class: 'ttl' }, '本人確認'),
        h('p', { class: 'lead' }, '社員番号と生年月日が一致すると、登録内容の更新画面に進みます。')),
      h('form', { class: 'sec', onSubmit: submit },
        h('label', { class: 'fld' }, h('span', { class: 'lb' }, '社員番号'),
          vin('code', '', '7桁の数字', '社員番号', 10)),
        h('div', { class: 'fld' },
          h('span', { class: 'lb' }, '生年月日（西暦）'),
          h('div', { class: 'date' },
            vin('y', 'y', '1990', '生年月日の年', 4), h('span', null, '年'),
            vin('m', 'md', '1', '生年月日の月', 2), h('span', null, '月'),
            vin('d', 'md', '1', '生年月日の日', 2), h('span', null, '日')),
          h('span', { style: 'font-size:12px;color:#5A6475' }, '月・日は「1」でも「01」でもOK')),
        M.vErr ? h('div', { class: 'note red', role: 'alert' }, M.vErr) : null,
        h('button', { type: 'submit', class: 'btn pri' }, '確認する')),
      h('p', { style: 'margin:0 4px;font-size:12.5px;color:#5A6475;line-height:1.6' },
        '5回続けて一致しないと、いったんログアウトされます。まだ登録していない方はメニューの「新規登録」からどうぞ。'));
  }
};

// ---------- 更新フォーム ----------

function statusNotes() {
  var r = M.myReqs[0];
  if (!r) return null;
  if (r.status === 'pending') {
    return h('div', { class: 'note orange', style: 'align-items:center' },
      h('div', { style: 'flex-grow:1;display:flex;flex-direction:column;gap:2px' },
        h('div', { style: 'font-size:12px;font-weight:700;color:#92400E' }, '申請状況：承認待ち'),
        h('div', null, fmtStamp(r.requested_at) + ' の申請を役員が確認中です。新しく申請すると前回分は破棄され、置き換わります。')),
      h('button', { type: 'button', class: 'link', onClick: function (e) {
        withBusy(e.currentTarget, Api.call('cancelRequest', Object.assign({ request_id: r.request_id }, M.auth))).then(function () {
          r.status = 'cancelled';
          r.statusLabel = '取り消し';
          render();
          toast('申請を取り消しました');
        }, function (err) { toast(err.message, 'err'); });
      } }, '取り消す'));
  }
  if (r.status === 'rejected') {
    return note('red', 'alert', [
      h('div', { style: 'font-weight:700' }, '前回の申請（' + fmtStamp(r.requested_at) + '）は却下されました'),
      h('div', null, '理由：' + (r.reject_reason || '—')),
      h('div', { style: 'font-size:12px' }, '内容を直して、もう一度申請してください。')]);
  }
  if (r.status === 'cancelled') {
    return h('div', { class: 'note', style: 'background:#EEF0F3;color:#2A3547' }, fmtStamp(r.requested_at) + ' の申請は取り消し済みです。');
  }
  if (r.status === 'approved') {
    return note('green', 'check', fmtStamp(r.requested_at) + ' の申請は承認され、台帳に反映済みです。');
  }
  return null;
}

SCREENS.update = {
  title: '登録内容の更新',
  back: function () { go('menu'); },
  view: function () {
    var b = M.base;
    return h('div', { class: 'wrap' },
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;padding:0 4px' },
        h('h2', { class: 'ttl' }, '登録内容の更新'),
        h('p', { class: 'lead' }, '変わったところだけ直して「確認へ進む」を押してください。')),
      statusNotes(),
      h('div', { style: 'display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:14px;background:#0E1A33;color:#fff' },
        h('div', { style: 'width:40px;height:40px;border-radius:50%;background:#1F3FBF;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0' }, (b.sei || '?').charAt(0)),
        h('div', { style: 'flex-grow:1;display:flex;flex-direction:column;gap:2px;min-width:0' },
          h('div', { style: 'font-weight:700' }, b.sei + ' ' + b.mei + ' さん'),
          h('div', { class: 'num-t', style: 'font-size:12.5px;color:#C3CDE6' },
            '社員番号 ' + b.employee_code + '・' + fmtDate(b.birth_date) + '（' + ageOf(b.birth_date) + '）'))),
      h('p', { style: 'margin:0 4px;font-size:12px;color:#5A6475' }, '社員番号・生年月日の訂正は役員に連絡してください。'),
      formSections());
  },
  bar: formBar
};

// ---------- 確認（台帳の形で表示） ----------

function currentRecord() { return formToRecord(M.f); }

function editScreen() { return M.mode === 'update' ? 'update' : M.mode === 'edit' ? 'a-edit' : 'new'; }

function noChanges() {
  if (M.mode === 'new') return false;
  var a = currentRecord(), b = M.base;
  var same = Object.keys(a).every(function (k) { return String(a[k] || '') !== String(b[k] || '') ? false : true; });
  return same && JSON.stringify(familyToRecord(M.fam).map(famKey_)) === JSON.stringify((M.baseFam || []).map(famKey_));
}

SCREENS.confirm = {
  title: function () { return M.mode === 'edit' ? '編集内容の確認' : '内容の確認'; },
  back: function () { go(editScreen()); },
  view: function () {
    var today = new Date();
    var made = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    var opts = { rec: currentRecord(), fam: familyToRecord(M.fam), madeAt: made };
    if (M.mode !== 'new') { opts.base = M.base; opts.baseFam = M.baseFam; }
    return h('div', { class: 'wrap w-sheet' },
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;padding:0 4px' },
        h('h2', { class: 'ttl' }, M.mode === 'edit' ? '編集内容の確認' : '内容の確認'),
        h('p', { class: 'lead' }, M.mode !== 'new'
          ? '紙の台帳と同じ形で表示しています。変更した所は黄色になっています。'
          : '紙の台帳と同じ形で表示しています。間違いがないか確認してください。')),
      ledgerView(opts, M.lv, render),
      noChanges() ? h('div', { class: 'note red' }, '変更がありません。「修正する」から戻って変更してください。') : null,
      M.mode === 'edit'
        ? note('orange', 'info', '「保存する」を押すと、承認なしですぐ台帳に反映されます。変更前の内容は変更履歴に残るので、あとで元に戻せます。')
        : note('blue', 'info', '内容に間違いがなければ「この内容で申請する」を押してください。間違えた場合は、もう一度申請すれば前回の申請は破棄され、新しい内容に更新されます。'));
  },
  bar: function () {
    return h('div', { class: 'bbar' }, h('div', { class: 'bbar-in', style: 'display:grid;grid-template-columns:1fr 2fr' },
      h('button', { type: 'button', class: 'btn sec', onClick: SCREENS.confirm.back }, '修正する'),
      h('button', { type: 'button', class: 'btn pri', disabled: noChanges(), onClick: submitRequest }, M.mode === 'edit' ? '保存する' : 'この内容で申請する')));
  }
};

function submitRequest(e) {
  var params = { record: currentRecord(), family: familyToRecord(M.fam) };
  var action = 'submitCreate';
  if (M.mode === 'update') { action = 'submitUpdate'; params.auth = M.auth; }
  if (M.mode === 'edit') { action = 'updateMember'; params.member_id = M.base.member_id; params.base_updated_at = M.base.updated_at; }
  withBusy(e.currentTarget, Api.call(action, params)).then(function (d) {
    if (M.mode === 'edit') {
      toast('保存しました。台帳に反映されています');
      openLedger(M.base.member_id);
      resetMember();
      return;
    }
    M.done = d;
    go('done');
  }, function (err) {
    if (M.mode === 'edit' && err.code === 'stale') {
      toast(err.message, 'err');
      openLedger(M.base.member_id);
    } else if (err.code === 'invalid' && err.extra && err.extra.errors) {
      M.tried = true;
      M.errs = serverErrors(err.extra.errors);
      go(editScreen());
      scrollToError();
      toast(err.message, 'err');
    } else if (err.code === 'registered') {
      M.idState = 'dupe';
      go('new');
      toast(err.message, 'err');
    } else {
      toast(err.message, 'err');
    }
  });
}

// ---------- 完了 ----------

SCREENS.done = {
  title: '申請しました',
  view: function () {
    var d = M.done || {};
    return h('div', { class: 'wrap', style: 'max-width:520px;padding-top:56px;align-items:center;text-align:center;gap:18px' },
      h('div', { style: 'width:84px;height:84px;border-radius:50%;background:#E7F6F0;display:flex;align-items:center;justify-content:center' },
        h('div', { style: 'width:60px;height:60px;border-radius:50%;background:#0F7B5F;color:#fff;display:flex;align-items:center;justify-content:center' }, ico('check', 30))),
      h('h2', { class: 'ttl', style: 'font-size:26px' }, '申請しました'),
      h('p', { class: 'lead', style: 'font-size:14px' }, '役員が内容を確認し、承認されると台帳に反映されます。'),
      h('div', { style: 'width:100%;padding:16px;border-radius:14px;background:#fff;border:1px solid #E3E6EB;display:flex;justify-content:space-between;align-items:center;gap:12px' },
        h('span', { style: 'font-size:13px;color:#5A6475' }, '受付番号'),
        h('span', { class: 'num-t', style: 'font-size:16px;font-weight:700;letter-spacing:.04em;word-break:break-all' }, d.request_id || '')),
      d.replaced ? note('blue', 'info', '承認待ちだった前回の申請は、この申請に置き換えました。', 'text-align:left') : null,
      note('orange', 'restore', '間違えた場合は、もう一度申請してください。前回の申請は破棄され、新しい内容に更新されます（役員が承認する前まで）。', 'text-align:left'),
      h('button', { type: 'button', class: 'btn pri full', onClick: function () { resetMember(); go('menu'); } }, 'メニューへ戻る'));
  }
};

// ---------- 役員：台帳の直接編集 ----------

function startEdit(member, family) {
  resetMember();
  M.mode = 'edit';
  M.base = member;
  M.baseFam = family;
  M.f = recordToForm(member);
  M.fam = recordToFamily(family);
  go('a-edit');
}

SCREENS['a-edit'] = {
  title: '台帳の編集',
  back: function () {
    var id = M.base.member_id;
    resetMember();
    openLedger(id);
  },
  view: function () {
    var b = M.base;
    return h('div', { class: 'wrap' },
      h('div', { style: 'display:flex;flex-direction:column;gap:4px;padding:0 4px' },
        h('h2', { class: 'ttl' }, b.sei + ' ' + b.mei + ' さんの台帳を編集'),
        h('p', { class: 'lead' }, '役員による直接の修正です。承認なしで反映され、変更前の内容は変更履歴に残ります。')),
      section('0', '社員番号と生年月日', [
        h('label', { class: 'fld' },
          h('span', { class: 'lb' }, '社員番号', h('em', { class: 'req' }, '必須')),
          inp('employee_code', { mode: 'numeric', ph: '7桁の数字', style: 'letter-spacing:.12em', max: 10 })),
        errP('employee_code'),
        fld('生年月日（西暦）', true, dateIn('birth', 'birth', '生年月日', ['1990', '1', '1'])),
        errP('birth'),
        h('p', { style: 'margin:0;font-size:12.5px;color:#5A6475;line-height:1.6' },
          '本人確認に使う項目です。訂正するときだけ変更してください。')]),
      formSections());
  },
  bar: formBar
};
