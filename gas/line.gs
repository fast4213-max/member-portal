/**
 * line.gs — LINE通知（Messaging API の push だけ。Webhook は使わない）
 *
 *  ・1日1回（時間主導型トリガー）、新しい承認待ちが増えていたら
 *    「承認待ちの申請が N 件あります」だけを役員グループに送る（氏名などは書かない）
 *  ・通知済みフラグ（change_requests.notified）は送信に成功したときだけ付ける
 *  ・Bot は最大5個をローテーション。残り通数がグループ人数以上ある最初の Bot で送る
 *
 * スクリプトプロパティ
 *   LINE_TOKENS   … チャネルアクセストークンの JSON 配列 例：["xxxx","yyyy"]
 *   LINE_GROUP_ID … 送信先グループの groupId
 *   SITE_URL      … （任意）通知に添える管理画面のURL
 */

var LINE_API = 'https://api.line.me/v2/bot';
var LINE_MAX_RETRY = 3;

/** 時間主導型トリガーから毎日呼ばれる */
function notifyPending() {
  if (!prop_('LINE_TOKENS') || !prop_('LINE_GROUP_ID')) {
    console.log('LINE 未設定のため通知をスキップ');
    return;
  }
  var pending = readAll_('change_requests').filter(function (r) { return r.status === 'pending'; });
  var fresh = pending.filter(function (r) { return r.notified !== 'TRUE'; });
  if (!fresh.length) {
    console.log('新しい承認待ちなし');
    return;
  }
  var text = '承認待ちの申請が ' + pending.length + ' 件あります。管理画面で確認してください。';
  if (prop_('SITE_URL')) text += '\n' + prop_('SITE_URL');

  if (!sendLine_([{ type: 'text', text: text }])) return;   // 失敗したら未通知のまま（次回また送る）

  withLock_(function () {
    var ids = {};
    fresh.forEach(function (r) { ids[r.request_id] = true; });
    readAll_('change_requests').forEach(function (r) {
      if (ids[r.request_id]) { r.notified = 'TRUE'; updateRow_('change_requests', r); }
    });
  });
}

/**
 * メッセージ（最大5個）をグループに送る。成功したら true
 */
function sendLine_(messages) {
  var tokens = JSON.parse(prop_('LINE_TOKENS') || '[]').slice(0, 5);
  var groupId = prop_('LINE_GROUP_ID');
  messages = messages.slice(0, 5).map(function (m) {
    return m.type === 'text' ? { type: 'text', text: String(m.text).slice(0, 5000) } : m;
  });

  for (var i = 0; i < tokens.length; i++) {
    var label = 'Bot' + (i + 1);
    try {
      var need = lineGet_(tokens[i], '/group/' + encodeURIComponent(groupId) + '/members/count').count || 1;
      var remain = lineRemaining_(tokens[i]);
      if (remain < need) {
        console.log(label + '：今月の残り ' + remain + ' 通 < グループ ' + need + ' 人のため次へ');
        continue;
      }
      var res = linePush_(tokens[i], groupId, messages);
      if (res === 'ok') { console.log(label + ' で送信しました'); return true; }
      if (res === 'fatal') return false;             // 400：内容が不正。Botを変えても同じ
      console.log(label + '：' + res + ' のため次のBotへ');
    } catch (e) {
      console.error(label + '：' + e.message);
    }
  }
  console.error('LINE：送信できるBotがありませんでした（未通知のまま次回に再送）');
  return false;
}

/** 今月あと何通送れるか（上限なしなら大きな数） */
function lineRemaining_(token) {
  var quota = lineGet_(token, '/message/quota');
  if (quota.type !== 'limited') return 1e9;
  var used = lineGet_(token, '/message/quota/consumption').totalUsage || 0;
  return quota.value - used;
}

function lineGet_(token, path) {
  var res = UrlFetchApp.fetch(LINE_API + path, {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 200) throw new Error('GET ' + path.replace(/\/group\/[^/]+/, '/group/…') + ' → ' + code);
  return JSON.parse(res.getContentText());
}

/**
 * push を送る。戻り値：'ok' / 'monthly_limit' / 'unauthorized' / 'fatal' / 'failed'
 * 同じ X-Line-Retry-Key でリトライするので二重送信にならない（409 は送信済み扱い）
 */
function linePush_(token, groupId, messages) {
  var retryKey = Utilities.getUuid();
  for (var attempt = 0; attempt <= LINE_MAX_RETRY; attempt++) {
    if (attempt > 0) Utilities.sleep(1000 * Math.pow(2, attempt - 1));   // 1秒, 2秒, 4秒
    var res;
    try {
      res = UrlFetchApp.fetch(LINE_API + '/message/push', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + token, 'X-Line-Retry-Key': retryKey },
        payload: JSON.stringify({ to: groupId, messages: messages })
      });
    } catch (netErr) {
      console.log('push ネットワークエラー（' + (attempt + 1) + '回目）：' + netErr.message);
      continue;
    }
    var code = res.getResponseCode(), body = res.getContentText();
    if (code === 200 || code === 409) return 'ok';
    if (code === 429 && /monthly limit/i.test(body)) return 'monthly_limit';
    if (code === 401) { console.error('push 401：トークンが無効です'); return 'unauthorized'; }
    if (code === 400) { console.error('push 400：送信内容が不正です ' + body.slice(0, 300)); return 'fatal'; }
    console.log('push ' + code + '（' + (attempt + 1) + '回目）');   // それ以外の429・5xx はリトライ
  }
  return 'failed';
}
