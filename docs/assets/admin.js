/*
 * admin.js — 役員の画面（台帳一覧・台帳表示・承認待ち・行動ログ・ゴミ箱）
 */
'use strict';

var A;

function resetAdmin() {
  A = {
    pendingCount: 0, trashCount: 0, totalAll: null,
    list: { row: '', q: '', page: 1, data: null },
    ledger: { id: null, data: null, history: [], lv: { view: 'list', zoom: false } },
    req: { items: null, selId: null, detail: null, rejecting: false, reason: '', showSheet: false, lv: { view: 'list', zoom: false } },
    log: { cat: 'all', period: '7', page: 1, data: null },
    trash: { items: null, purgeDays: 90 }
  };
}
resetAdmin();

var FIELD_LABELS = {
  sei: '氏名（姓）', mei: '氏名（名）', sei_kana: 'フリガナ（セイ）', mei_kana: 'フリガナ（メイ）', gender: '性別',
  birth_date: '生年月日', job_title: '職名', contract_join_date: '契約社員入社年月日', regular_join_date: '正社員入社年月日',
  tel_home: '電話（自宅）', tel_mobile: '電話（携帯）', zip: '現住所 〒', address: '現住所',
  family_zip: '実家住所 〒', family_address: '実家住所', family_tel: '実家電話', employee_code: '社員番号',
  station_home_line: '最寄駅 自宅（線）', station_home: '最寄駅 自宅（駅）', station_family_line: '最寄駅 実家（線）', station_family: '最寄駅 実家（駅）',
  kyosai_sogo: '総合共済', kyosai_kyuen: '救援共済', kotsu_seisaku: '交通政策をすすめる会', kyosai_kazoku: '家族支援共済',
  prev_workplace: '前職場', officer_exp: '組合役員経験', officer_when: '組合役員経験（以前／現在）', officer_detail: '組合役員経験（所属箇所と役職）'
};

var ACTIONS = {
  login_ok: ['ログイン', 'login'], login_fail: ['ログイン失敗', 'warn'], lockout: ['ロック', 'warn'], denied: ['権限なし', 'warn'],
  view_list: ['一覧表示', 'view'], view_detail: ['詳細表示', 'view'], view_log: ['ログ閲覧', 'view'], 'export': ['書き出し', 'view'],
  request_create: ['新規申請', 'request'], request_update: ['更新申請', 'request'], request_supersede: ['申請置換', 'request'],
  request_cancel: ['申請取消', 'request'], request_limit: ['申請回数超過', 'warn'],
  approve: ['承認', 'review'], reject: ['却下', 'review'], edit: ['役員が編集', 'review'],
  'delete': ['削除', 'trash'], restore: ['復元', 'trash'], purge: ['完全削除', 'trash'], rollback: ['以前の版に戻す', 'trash']
};

var ROW_CHIPS = [['', 'すべて'], ['a', 'あ'], ['ka', 'か'], ['sa', 'さ'], ['ta', 'た'], ['na', 'な'], ['ha', 'は'], ['ma', 'ま'], ['ya', 'や'], ['ra', 'ら'], ['wa', 'わ']];
var LOG_CATS = [['all', 'すべて'], ['login', 'ログイン'], ['view', '閲覧'], ['request', '申請'], ['review', '承認・却下'], ['trash', '削除・復元']];
var HISTORY_LABELS = { approve: '承認で更新（更新前の内容）', edit: '役員が編集（編集前の内容）', rollback: '以前の版に戻した（戻す前の内容）', 'delete': 'ゴミ箱へ移動（その時点の内容）' };

function apiErr(err) { toast(err.message, 'err'); }

function enterAdmin() {
  resetAdmin();
  go('a-list');
  loadList();
  loadReqs(true);
  loadTrash(true);
}

function openAdmin(screen) {
  go(screen);
  if (screen === 'a-list') loadList();
  if (screen === 'a-req') loadReqs();
  if (screen === 'a-log') loadLogs();
  if (screen === 'a-trash') loadTrash();
}

function loading() {
  return h('div', { style: 'padding:48px 20px;text-align:center;color:#5A6475;font-size:14px' }, '読み込み中…');
}

function pager(data, onPage) {
  return h('div', { class: 'pfoot' },
    h('span', null, data.total + ' 件'),
    data.pages > 1 ? h('div', { class: 'pager' },
      h('button', { type: 'button', class: 'btn sec sm', disabled: data.page <= 1, onClick: function () { onPage(data.page - 1); } }, '前へ'),
      h('span', { class: 'num-t' }, data.page + ' / ' + data.pages),
      h('button', { type: 'button', class: 'btn sec sm', disabled: data.page >= data.pages, onClick: function () { onPage(data.page + 1); } }, '次へ'))
      : h('span', null, '1 / 1 ページ'));
}

// ---------- 台帳一覧 ----------

var searchTimer = null;

function loadList() {
  var L = A.list;
  withBusy(null, Api.call('listMembers', { row: L.row, q: L.q, page: L.page })).then(function (d) {
    L.data = d;
    if (!L.row && !L.q) A.totalAll = d.total;
    render();
  }, apiErr);
}

SCREENS['a-list'] = {
  title: '台帳一覧',
  view: function () {
    var L = A.list, d = L.data, wide = isWide();
    var stat = function (label, value, unit, dark, onClick) {
      return h(onClick ? 'button' : 'div', { type: onClick ? 'button' : null, class: 'stat' + (dark ? ' dark' : ''), onClick: onClick },
        h('div', { class: 'k' }, label),
        h('div', { class: 'sv' }, value == null ? '—' : value, h('span', { class: 'su' }, unit)));
    };
    var rows;
    if (!d) rows = loading();
    else if (!d.items.length) rows = h('div', { style: 'padding:48px 20px;text-align:center;color:#5A6475;font-size:14px;border-top:1px solid #EEF0F3' }, '該当する組合員がいません');
    else if (wide) {
      rows = [h('div', { class: 'tr hd' },
        h('div', { class: 'th' }, '社員番号'), h('div', { class: 'th' }, '氏名'), h('div', { class: 'th' }, 'フリガナ'),
        h('div', { class: 'th' }, '年齢'), h('div', { class: 'th' }, '更新日'), h('div'))].concat(d.items.map(function (m) {
        var open = function () { openLedger(m.member_id); };
        return h('div', { class: 'tr' },
          h('div', { class: 'num-t', style: 'font-size:14px;color:#2A3547;letter-spacing:.04em' }, m.employee_code),
          h('div', null, h('button', { type: 'button', class: 'nm', onClick: open }, m.name)),
          h('div', { style: 'font-size:13.5px;color:#5A6475' }, m.kana),
          h('div', { class: 'num-t', style: 'font-size:14px' }, m.age == null ? '' : m.age + '歳'),
          h('div', { class: 'num-t', style: 'font-size:14px;color:#2A3547' }, fmtStamp(m.updated_at).split(' ')[0]),
          h('button', { type: 'button', class: 'icb', 'aria-label': m.name + ' の台帳を開く', style: 'width:36px;height:36px;color:#9AA3B2', onClick: open }, ico('next', 18)));
      }));
    } else {
      rows = d.items.map(function (m) {
        return h('button', { type: 'button', class: 'mrow', onClick: function () { openLedger(m.member_id); } },
          h('div', { style: 'flex-grow:1;min-width:0;display:flex;flex-direction:column;gap:3px' },
            h('div', { style: 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap' },
              h('span', { style: 'font-size:16px;font-weight:700' }, m.name),
              h('span', { style: 'font-size:12px;color:#5A6475' }, m.kana)),
            h('div', { class: 'num-t', style: 'font-size:12.5px;color:#5A6475' },
              m.employee_code + '・' + (m.age == null ? '' : m.age + '歳') + '・更新 ' + fmtStamp(m.updated_at).split(' ')[0])),
          h('span', { style: 'color:#9AA3B2' }, ico('next', 18)));
      });
    }
    return h('div', { class: 'wrap w-admin', style: 'gap:20px' },
      h('div', { class: 'stats' },
        stat('登録者数', A.totalAll, '人'),
        stat('承認待ち', A.pendingCount, '件 →', true, function () { openAdmin('a-req'); }),
        stat('ゴミ箱', A.trashCount, '件')),
      h('div', { class: 'panel' },
        h('div', { class: 'toolbar' },
          h('div', { class: 'chips', role: 'group', 'aria-label': 'フリガナの行で絞り込み' }, ROW_CHIPS.map(function (c) {
            var on = L.row === c[0];
            return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on),
              onClick: function () { L.row = c[0]; L.page = 1; L.data = null; render(); loadList(); } }, c[1]);
          })),
          h('div', { class: 'srch-w' },
            ico('search', 18, 'position:absolute;left:13px;top:13px;color:#5A6475'),
            h('input', { class: 'srch', type: 'search', value: L.q, 'data-key': 'list.q', placeholder: '氏名・フリガナ・社員番号で検索',
              'aria-label': '検索', maxlength: 40,
              onInput: function (e) {
                L.q = e.target.value;
                clearTimeout(searchTimer);
                searchTimer = setTimeout(function () { L.page = 1; loadList(); }, 450);
              } }))),
        rows,
        d ? pager(d, function (p) { L.page = p; loadList(); }) : null));
  }
};

// ---------- 台帳表示 ----------

function openLedger(id) {
  var G = A.ledger;
  G.id = id; G.data = null; G.history = []; G.lv = { view: 'list', zoom: false };
  go('a-ledger');
  withBusy(null, Promise.all([Api.call('getMember', { member_id: id }), Api.call('listHistory', { member_id: id })])).then(function (r) {
    G.data = r[0];
    G.history = r[1].items;
    render();
  }, function (err) { apiErr(err); openAdmin('a-list'); });
}

function confirmDialog(title, body, okLabel, okCls, onOk) {
  return function () {
    return h('div', { class: 'dlg', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'h', style: 'font-weight:900;font-size:19px' }, title),
      h('p', { style: 'margin:0;font-size:14px;line-height:1.7;color:#2A3547' }, body),
      h('div', { style: 'display:flex;justify-content:flex-end;gap:10px;margin-top:6px' },
        h('button', { type: 'button', class: 'btn sec sm', onClick: closeDialog }, 'キャンセル'),
        h('button', { type: 'button', class: 'btn ' + okCls + ' sm', onClick: onOk }, okLabel)));
  };
}

SCREENS['a-ledger'] = {
  title: function () { var d = A.ledger.data; return d ? d.member.sei + ' ' + d.member.mei + ' の台帳' : '台帳'; },
  back: function () { openAdmin('a-list'); },
  actions: function () {
    var d = A.ledger.data;
    if (!d) return null;
    return h('div', { style: 'display:flex;gap:8px;margin-right:4px' },
      h('button', { type: 'button', class: 'btn dng sm ico', 'aria-label': 'ゴミ箱へ移動', onClick: function () {
        openDialog(confirmDialog('ゴミ箱に移動しますか？',
          d.member.sei + ' ' + d.member.mei + ' さんの台帳と家族情報をゴミ箱に移動します。一覧には表示されなくなりますが、ゴミ箱から復元できます。',
          'ゴミ箱へ移動', 'dngf', function (e) {
            withBusy(e.currentTarget, Api.call('deleteMember', { member_id: d.member.member_id })).then(function () {
              S.dialog = null;
              A.trashCount++;
              toast('ゴミ箱に移動しました');
              openAdmin('a-list');
            }, function (err) { closeDialog(); apiErr(err); });
          }));
      } }, ico('trash', 17), h('span', { class: 'bt-lbl' }, 'ゴミ箱へ移動')),
      h('button', { type: 'button', class: 'btn sec sm ico', 'aria-label': '編集', onClick: function () { startEdit(d.member, d.family); } },
        ico('edit', 17), h('span', { class: 'bt-lbl' }, '編集')),
      h('button', { type: 'button', class: 'btn pri sm ico', 'aria-label': '印刷', onClick: function () { window.print(); } },
        ico('print', 17), h('span', { class: 'bt-lbl' }, '印刷（A4）')));
  },
  view: function () {
    var G = A.ledger, d = G.data;
    if (!d) return h('div', { class: 'wrap w-sheet' }, loading());
    var m = d.member;
    var side = h('div', { class: 'sidep noprint' },
      h('div', { class: 'sbox' },
        h('div', { style: 'font-size:13px;font-weight:700' }, '登録情報'),
        h('div', { class: 'kv' }, h('span', null, '登録日'), h('span', { class: 'num-t' }, fmtStamp(m.created_at))),
        h('div', { class: 'kv' }, h('span', null, '最終更新'), h('span', { class: 'num-t' }, fmtStamp(m.updated_at)))),
      h('div', { class: 'sbox' },
        h('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px' },
          h('div', { style: 'font-size:13px;font-weight:700' }, '変更履歴'),
          h('span', { style: 'font-size:12px;color:#5A6475' }, '以前の版に戻せます')),
        G.history.length ? G.history.map(function (hs) {
          return h('div', { style: 'display:flex;gap:12px;align-items:flex-start' },
            h('div', { style: 'width:8px;height:8px;border-radius:50%;background:#1F3FBF;margin-top:6px;flex-shrink:0' }),
            h('div', { style: 'flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-width:0' },
              h('div', { class: 'num-t', style: 'font-size:13px;font-weight:600' }, fmtStamp(hs.changed_at)),
              h('div', { style: 'font-size:12.5px;color:#5A6475' }, HISTORY_LABELS[hs.reason] || hs.reason)),
            h('button', { type: 'button', class: 'link', style: 'color:#1F3FBF', onClick: function () {
              openDialog(confirmDialog('この版に戻しますか？',
                fmtStamp(hs.changed_at) + ' の「' + (HISTORY_LABELS[hs.reason] || hs.reason) + '」に戻します。いまの内容も履歴に残るので、あとで元に戻せます。',
                'この版に戻す', 'pri', function (e) {
                  withBusy(e.currentTarget, Api.call('rollback', { history_id: hs.history_id })).then(function () {
                    S.dialog = null;
                    toast('以前の版に戻しました');
                    openLedger(m.member_id);
                  }, function (err) { closeDialog(); apiErr(err); });
                }));
            } }, '戻す'));
        }) : h('div', { style: 'font-size:12.5px;color:#5A6475' }, 'まだ変更はありません')),
      h('div', { class: 'caution' }, 'この画面を開いたことは行動ログに記録されます。印刷物の取り扱いに注意してください。'));
    return h('div', { class: 'wrap w-sheet' },
      h('div', { class: 'sheet-layout with-side' },
        ledgerView({ rec: m, fam: d.family, madeAt: m.updated_at }, G.lv, render),
        side));
  }
};

// ---------- 承認待ち ----------

function loadReqs(countOnly) {
  var R = A.req;
  withBusy(null, Api.call('listRequests')).then(function (d) {
    R.items = d.items;
    A.pendingCount = d.items.length;
    if (!countOnly && R.selId && !d.items.some(function (x) { return x.request_id === R.selId; })) {
      R.selId = null; R.detail = null;
    }
    if (!countOnly && isWide() && !R.selId && d.items.length) { selectReq(d.items[0].request_id); return; }
    render();
  }, apiErr);
}

function selectReq(id) {
  var R = A.req;
  R.selId = id; R.detail = null; R.detailErr = ''; R.rejecting = false; R.reason = ''; R.showSheet = false; R.lv = { view: 'list', zoom: false };
  render();
  withBusy(null, Api.call('getRequest', { request_id: id })).then(function (d) {
    if (R.selId !== id) return;
    R.detail = d;
    render();
  }, function (err) {
    if (R.selId !== id) return;
    R.detailErr = err.message;
    render();
  });
}

function famSummary(list) {
  return (list || []).map(function (m) {
    return [m.sei, m.mei].join(' ') + '（' + [m.relationship, m.living_together].filter(Boolean).join('・') + '）';
  }).join('、') || 'なし';
}

function diffValue(k, v) {
  return /_date$/.test(k) ? fmtDate(v) : v;
}

function requestDetail() {
  var R = A.req, d = R.detail, it = (R.items || []).filter(function (x) { return x.request_id === R.selId; })[0];
  if (!d && R.detailErr) {
    return h('div', { class: 'panel', style: 'padding:20px;display:flex;flex-direction:column;gap:12px;align-items:flex-start' },
      note('red', 'alert', ['申請の内容を読み込めませんでした。', h('br'), R.detailErr]),
      h('button', { type: 'button', class: 'btn sec sm', onClick: function () { selectReq(R.selId); } }, ico('restore', 16), '再読み込み'));
  }
  if (!d) return h('div', { class: 'panel' }, loading());
  var q = d.request, after = d.after.member, isNew = q.type === 'create';
  var head = h('div', { style: 'padding:18px 20px;display:flex;flex-direction:column;gap:8px' },
    h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
      h('span', { class: 'tag ' + (isNew ? 'new' : 'upd') }, isNew ? '新規' : '更新'),
      h('span', { class: 'num-t', style: 'font-size:12.5px;color:#5A6475' }, fmtStamp(q.requested_at) + ' 申請・申請者 ' + q.requester),
      it && it.rejectStreak ? h('span', { class: 'tag warn' }, '却下が' + it.rejectStreak + '回続いています') : null),
    h('div', { class: 'h', style: 'font-size:22px;font-weight:900' }, after.sei + ' ' + after.mei),
    h('div', { class: 'num-t', style: 'font-size:13px;color:#5A6475' }, after.sei_kana + ' ' + after.mei_kana + '・社員番号 ' + after.employee_code));

  var notes = [];
  if (d.gone) notes.push(note('red', 'alert', '対象の台帳が見つかりません（ゴミ箱に移動された可能性があります）。承認できません。'));
  if (d.stale) notes.push(note('orange', 'warn', '申請のあとに台帳が更新されています（申請時 ' + fmtStamp(d.base_updated_at) + ' → 現在 ' + fmtStamp(d.current_updated_at) + '）。下の差分は「いまの台帳」との比較です。内容を確かめてから承認してください。'));

  var body;
  if (isNew || R.showSheet) {
    body = h('div', { style: 'padding:0 20px 16px' },
      ledgerView({ rec: after, fam: d.after.family, base: isNew ? null : d.before.member, baseFam: isNew ? null : d.before.family, madeAt: q.requested_at }, R.lv, render));
  } else {
    var rows = d.changedFields.map(function (k) {
      return h('div', { class: 'dr' },
        h('div', { style: 'font-weight:600;color:#2A3547;font-size:13px' }, FIELD_LABELS[k] || k),
        h('div', { class: 'bf', style: 'color:#8A93A3;word-break:break-all' }, diffValue(k, d.before.member[k]) || '（空欄）'),
        h('div', { style: 'word-break:break-all' }, h('span', { class: 'hlv' }, diffValue(k, after[k]) || '（空欄）')));
    });
    if (d.familyChanged) {
      rows.push(h('div', { class: 'dr' },
        h('div', { style: 'font-weight:600;color:#2A3547;font-size:13px' }, 'ご家族構成'),
        h('div', { class: 'bf', style: 'color:#8A93A3' }, famSummary(d.before.family)),
        h('div', null, h('span', { class: 'hlv' }, famSummary(d.after.family)))));
    }
    if (!rows.length && !d.gone) rows.push(h('div', { class: 'dr' }, 'いまの台帳との違いはありません'));
    body = [h('div', { class: 'dr hd', style: 'background:#F8F9FC;padding-top:10px;padding-bottom:10px' },
      h('div', { class: 'th' }, '項目'), h('div', { class: 'th' }, '変更前'), h('div', { class: 'th' }, '変更後')), rows];
  }

  var approve = function (e) {
    var params = { request_id: q.request_id };
    if (d.stale) { params.ack_stale = true; params.seen_updated_at = d.current_updated_at; }
    withBusy(e.currentTarget, Api.call('approve', params)).then(function () {
      toast('承認して台帳に反映しました');
      R.selId = null; R.detail = null;
      loadReqs();
    }, function (err) {
      apiErr(err);
      if (err.code === 'superseded' || err.code === 'not_pending') { R.selId = null; R.detail = null; loadReqs(); }
      else if (err.code === 'stale') selectReq(q.request_id);
    });
  };
  var reject = function (e) {
    if (!R.reason.trim()) { toast('却下の理由を入力してください', 'err'); return; }
    withBusy(e.currentTarget, Api.call('reject', { request_id: q.request_id, reason: R.reason })).then(function () {
      toast('却下しました');
      R.selId = null; R.detail = null;
      loadReqs();
    }, function (err) {
      apiErr(err);
      if (err.code === 'superseded' || err.code === 'not_pending') { R.selId = null; R.detail = null; loadReqs(); }
    });
  };

  return h('div', { class: 'panel' },
    head,
    notes.length ? h('div', { style: 'padding:0 20px 14px;display:flex;flex-direction:column;gap:10px' }, notes) : null,
    isNew ? null : h('div', { style: 'padding:0 20px 12px' },
      h('button', { type: 'button', class: 'zoom', onClick: function () { R.showSheet = !R.showSheet; render(); } },
        R.showSheet ? '変更点だけを表で見る' : '申請内容を台帳の形で見る')),
    body,
    R.rejecting ? h('div', { style: 'padding:16px 20px;border-top:1px solid #EEF0F3;display:flex;flex-direction:column;gap:8px;background:#FFFBFA' },
      h('label', { for: 'reason', style: 'font-size:13px;font-weight:700' }, '却下の理由（本人の申請状況に表示されます）'),
      h('textarea', { id: 'reason', class: 'ta', 'data-key': 'req.reason', maxlength: 200, value: R.reason,
        placeholder: '例：住所の番地が確認できません。もう一度入力してください。',
        onInput: function (e) { R.reason = e.target.value; } })) : null,
    h('div', { style: 'padding:16px 20px;border-top:1px solid #EEF0F3;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap' },
      R.rejecting
        ? [h('button', { type: 'button', class: 'btn sec sm', onClick: function () { R.rejecting = false; render(); } }, 'やめる'),
           h('button', { type: 'button', class: 'btn dngf sm', onClick: reject }, '却下を確定')]
        : [h('button', { type: 'button', class: 'btn dng sm', onClick: function () { R.rejecting = true; render(); } }, '却下する'),
           h('button', { type: 'button', class: 'btn ok sm', disabled: !!d.gone, onClick: approve },
             ico('check', 18), d.stale ? '確認したので承認する' : '承認して反映')]));
}

SCREENS['a-req'] = {
  title: '承認待ち',
  backFn: function () {
    return !isWide() && A.req.selId ? function () { A.req.selId = null; A.req.detail = null; render(); } : null;
  },
  view: function () {
    var R = A.req, wide = isWide();
    if (!R.items) return h('div', { class: 'wrap w-admin' }, loading());
    var list = h('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      h('div', { style: 'font-size:13px;font-weight:700;color:#5A6475;padding:0 4px' }, '承認待ち ' + R.items.length + ' 件（新しい順）'),
      R.items.length ? R.items.map(function (r) {
        return h('button', { type: 'button', class: 'rq' + (R.selId === r.request_id ? ' on' : ''), onClick: function () { selectReq(r.request_id); } },
          h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
            h('span', { class: 'tag ' + (r.type === 'create' ? 'new' : 'upd') }, r.type === 'create' ? '新規' : '更新'),
            r.stale ? h('span', { class: 'tag warn' }, '台帳が更新済み') : null,
            r.rejectStreak ? h('span', { class: 'tag warn' }, '却下' + r.rejectStreak + '回') : null,
            h('span', { class: 'num-t', style: 'margin-left:auto;font-size:12px;color:#5A6475' }, fmtStamp(r.requested_at))),
          h('div', { style: 'font-size:16px;font-weight:700' }, r.name),
          h('div', { style: 'font-size:12.5px;color:#5A6475' }, r.changes || '—'));
      }) : h('div', { style: 'padding:32px 16px;border-radius:12px;background:#fff;border:1px dashed #D5DAE1;text-align:center;font-size:14px;color:#5A6475' }, '承認待ちの申請はありません'));
    if (!wide) return h('div', { class: 'wrap w-admin' }, R.selId ? requestDetail() : list);
    return h('div', { class: 'wrap w-admin' }, h('div', { class: 'reqgrid' }, list, R.selId ? requestDetail() : h('div')));
  }
};

// ---------- 行動ログ ----------

function periodFrom(p) {
  if (p === 'all') return '';
  var d = new Date();
  d.setDate(d.getDate() - (p === 'today' ? 0 : +p - 1));
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function loadLogs() {
  var G = A.log;
  withBusy(null, Api.call('listLogs', { category: G.cat === 'all' ? '' : G.cat, from: periodFrom(G.period), page: G.page })).then(function (d) {
    G.data = d;
    render();
  }, apiErr);
}

SCREENS['a-log'] = {
  title: '行動ログ',
  view: function () {
    var G = A.log, d = G.data, wide = isWide();
    var roleName = function (r) { return r === 'officer' ? '役員' : '組合員'; };
    var rows;
    if (!d) rows = loading();
    else if (!d.items.length) rows = h('div', { style: 'padding:48px 20px;text-align:center;color:#5A6475;font-size:14px;border-top:1px solid #EEF0F3' }, 'この条件のログはありません');
    else if (wide) {
      rows = [h('div', { class: 'lr hd' },
        ['日時', '権限', '操作者', '操作', '対象', '詳細（項目名のみ）'].map(function (t) { return h('div', { class: 'th' }, t); }))]
        .concat(d.items.map(function (l) {
          var a = ACTIONS[l.action] || [l.action, 'view'];
          return h('div', { class: 'lr' },
            h('div', { class: 'num-t', style: 'color:#2A3547' }, fmtStamp(l.timestamp)),
            h('div', { style: 'color:#5A6475' }, roleName(l.role)),
            h('div', { class: 'num-t' }, l.actor),
            h('div', null, h('span', { class: 'tag ' + a[1] }, a[0])),
            h('div', { style: 'font-weight:600' }, l.target_name || '—'),
            h('div', { style: 'color:#5A6475;word-break:break-all' }, l.detail || '—'));
        }));
    } else {
      rows = d.items.map(function (l) {
        var a = ACTIONS[l.action] || [l.action, 'view'];
        return h('div', { class: 'lcard' },
          h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' },
            h('span', { class: 'tag ' + a[1] }, a[0]),
            h('span', { style: 'font-weight:700' }, l.target_name || ''),
            h('span', { class: 'num-t', style: 'margin-left:auto;font-size:12px;color:#5A6475' }, fmtStamp(l.timestamp))),
          h('div', { style: 'font-size:12.5px;color:#5A6475;word-break:break-all' }, roleName(l.role) + '：' + l.actor + '　' + (l.detail || '')));
      });
    }
    var sel = h('select', { id: 'period', class: 'sel', onChange: function (e) { G.period = e.target.value; G.page = 1; G.data = null; render(); loadLogs(); } },
      [['today', '今日'], ['7', '過去7日'], ['30', '過去30日'], ['all', 'すべて']].map(function (o) { return h('option', { value: o[0] }, o[1]); }));
    sel.value = G.period;
    return h('div', { class: 'wrap w-admin' },
      h('div', { class: 'panel' },
        h('div', { class: 'toolbar' },
          h('div', { class: 'chips', role: 'group', 'aria-label': '操作の種類で絞り込み' }, LOG_CATS.map(function (c) {
            var on = G.cat === c[0];
            return h('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on),
              onClick: function () { G.cat = c[0]; G.page = 1; G.data = null; render(); loadLogs(); } }, c[1]);
          })),
          h('div', { class: 'srch-w', style: 'display:flex;align-items:center;gap:8px' },
            h('label', { for: 'period', style: 'font-size:13px;font-weight:600;color:#5A6475' }, '期間'), sel)),
        rows,
        d ? pager(d, function (p) { G.page = p; loadLogs(); }) : null,
        h('div', { class: 'pfoot', style: 'border-top:0;padding-top:0' }, h('span', null, 'ログは追記のみ（編集・削除はできません）。見るたびに「ログ閲覧」として記録されます。'))));
  }
};

// ---------- ゴミ箱 ----------

function loadTrash() {
  withBusy(null, Api.call('listTrash')).then(function (d) {
    A.trash.items = d.items;
    A.trash.purgeDays = d.purgeDays;
    A.trashCount = d.items.length;
    render();
  }, apiErr);
}

function purgeDialog(t) {
  var pw = { v: '' };
  return function () {
    return h('form', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', onSubmit: function (e) {
      e.preventDefault();
      if (!pw.v) { toast('管理用パスワードを入力してください', 'err'); return; }
      withBusy(e.target.querySelector('button[type=submit]'), Api.call('purgeMember', { member_id: t.member_id, password: pw.v })).then(function () {
        S.dialog = null;
        toast('完全に削除しました');
        loadTrash();
      }, function (err) {
        pw.v = '';
        var input = document.getElementById('rpw');
        if (input) input.value = '';
        apiErr(err);
      });
    } },
      h('div', { class: 'h', style: 'font-weight:900;font-size:19px;color:#912018' }, '完全に削除しますか？'),
      h('p', { style: 'margin:0;font-size:14px;line-height:1.7;color:#2A3547' },
        t.name + ' さんの台帳・家族・申請・変更履歴を完全に削除します。', h('b', null, 'この操作は元に戻せません。'), '実行前に自動でバックアップを取ります。'),
      h('label', { for: 'rpw', style: 'font-size:13px;font-weight:700' }, '確認のため、管理用パスワードをもう一度入力'),
      h('input', { id: 'rpw', class: 'pw', type: 'password', autocomplete: 'current-password', style: 'padding-right:16px', value: pw.v,
        onInput: function (e) { pw.v = e.target.value; } }),
      h('div', { style: 'display:flex;justify-content:flex-end;gap:10px;margin-top:6px' },
        h('button', { type: 'button', class: 'btn sec sm', onClick: closeDialog }, 'キャンセル'),
        h('button', { type: 'submit', class: 'btn dngf sm' }, '完全に削除する')));
  };
}

SCREENS['a-trash'] = {
  title: 'ゴミ箱',
  view: function () {
    var T = A.trash;
    if (!T.items) return h('div', { class: 'wrap w-admin' }, loading());
    return h('div', { class: 'wrap w-admin' },
      note('blue', 'info', '削除した台帳は家族情報とあわせてここに残ります。［復元］で元に戻せます。［完全削除］は削除から' + T.purgeDays + '日たったものだけ実行でき、実行前に自動でバックアップを取ります。'),
      h('div', { class: 'panel' },
        T.items.length ? T.items.map(function (t) {
          return h('div', { style: 'padding:16px 20px;border-top:1px solid #EEF0F3;display:flex;flex-wrap:wrap;align-items:center;gap:12px 16px' },
            h('div', { style: 'flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:3px' },
              h('span', { style: 'font-size:16px;font-weight:700' }, t.name),
              h('div', { class: 'num-t', style: 'font-size:12.5px;color:#5A6475' }, t.bunkai + '・削除 ' + fmtStamp(t.deleted_at) + '（' + t.deleted_by + '）'),
              h('div', { style: 'font-size:12px;color:' + (t.canPurge ? '#B42318' : '#5A6475') },
                t.canPurge ? '完全削除できます' : 'あと' + t.daysLeft + '日で完全削除できるようになります')),
            h('div', { style: 'display:flex;gap:8px;margin-left:auto' },
              h('button', { type: 'button', class: 'btn sec sm', onClick: function (e) {
                withBusy(e.currentTarget, Api.call('restoreMember', { member_id: t.member_id })).then(function () {
                  toast('復元しました。台帳一覧に戻っています');
                  loadTrash();
                }, apiErr);
              } }, ico('restore', 16), '復元'),
              h('button', { type: 'button', class: 'btn dng sm', disabled: !t.canPurge, onClick: function () { openDialog(purgeDialog(t)); } }, '完全削除')));
        }) : h('div', { style: 'padding:48px 20px;text-align:center;color:#5A6475;font-size:14px' }, 'ゴミ箱は空です'),
        h('div', { class: 'pfoot' }, h('span', null, T.items.length + ' 件'), h('span', null, '削除・復元・完全削除は行動ログに記録されます'))));
  }
};
