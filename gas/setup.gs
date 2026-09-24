/**
 * setup.gs — スプレッドシートの「台帳アプリ」メニュー（初期設定・パスワード設定など）
 *
 * パスワードやトークンは、このメニューから入力するとスクリプトプロパティに保存される。
 * コードやリポジトリには値を書かない。
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('台帳アプリ')
    .addItem('① 初期設定（シートを作る）', 'menuSetup')
    .addItem('② 共通パスワードを設定', 'menuSetMemberPassword')
    .addItem('③ 管理パスワードを設定', 'menuSetAdminPassword')
    .addItem('組織名（台帳の見出し）を設定', 'menuSetOrg')
    .addItem('④ 動作テスト', 'menuSelfTest')
    .addItem('⑤ Web接続テスト（デプロイ後）', 'menuWebTest')
    .addSeparator()
    .addItem('自動処理をオンにする（毎日のバックアップ・LINE通知）', 'menuInstallTriggers')
    .addItem('今すぐバックアップ', 'menuBackupNow')
    .addItem('LINEの設定', 'menuConfigureLine')
    .addItem('LINEにテスト送信', 'menuLineTest')
    .addSeparator()
    .addItem('全員をログアウトさせる', 'menuRevokeAll')
    .addItem('設定状況を確認', 'menuStatus')
    .addToUi();
}

function ui_() { return SpreadsheetApp.getUi(); }

function alert_(title, msg) { ui_().alert(title, msg, ui_().ButtonSet.OK); }

/** 入力ダイアログ。キャンセルなら null */
function ask_(title, msg) {
  var r = ui_().prompt(title, msg, ui_().ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui_().Button.OK ? r.getResponseText().trim() : null;
}

// ---------- ① 初期設定 ----------

function menuSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var notes = [];

  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('PASS_SALT')) {
    props.setProperty('PASS_SALT', Utilities.getUuid() + Utilities.getUuid());
    notes.push('ハッシュ用のランダム文字列（PASS_SALT）を作りました');
  }
  if (!props.getProperty('TOKEN_EPOCH')) props.setProperty('TOKEN_EPOCH', '0');

  Object.keys(SHEETS).forEach(function (name) {
    var headers = SHEETS[name];
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      notes.push('シート「' + name + '」を作りました');
    }
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#E8EDF7');
      sh.setFrozenRows(1);
    } else {
      var now = sh.getRange(1, 1, 1, headers.length).getValues()[0];
      if (now.join('|') !== headers.join('|')) {
        notes.push('⚠ シート「' + name + '」の1行目（見出し）が想定と違います。列を並べ替えていないか確認してください');
      }
    }
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
  });

  // 最初からある空のシートは消す
  ['シート1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  if (!props.getProperty('BACKUP_FOLDER_ID')) {
    var folder = DriveApp.createFolder('組合員台帳_バックアップ');
    props.setProperty('BACKUP_FOLDER_ID', folder.getId());
    notes.push('マイドライブにフォルダ「組合員台帳_バックアップ」を作りました');
  }

  alert_('初期設定が終わりました', (notes.length ? notes.join('\n') : '変更はありませんでした（設定済み）') +
         '\n\n次は「② 共通パスワードを設定」です。\n（台帳の見出しに出す組織名は「組織名（台帳の見出し）を設定」から）');
}

// ---------- ②③ パスワード ----------

function setPasswordFlow_(role, title) {
  if (!prop_('PASS_SALT')) return alert_(title, '先に「① 初期設定」を実行してください。');
  var pw = ask_(title, '新しいパスワードを入力してください（8文字以上）。\n※入力中の文字は画面に見えます。周りに人がいないところで設定してください。');
  if (pw === null) return;
  if (pw.length < 8) return alert_(title, '8文字以上にしてください。設定していません。');
  var pw2 = ask_(title, '確認のため、もう一度同じパスワードを入力してください。');
  if (pw2 === null) return;
  if (pw !== pw2) return alert_(title, '1回目と2回目が違います。設定していません。');

  var changed = !!prop_(passHashKey_(role));
  setProp_(passHashKey_(role), hashPassword_(pw));
  if (changed) revokeAllSessions_();
  alert_(title, '設定しました。' + (changed ? '\n（パスワード変更のため、ログイン中の人は全員ログアウトになりました）' : ''));
}

function menuSetMemberPassword() { setPasswordFlow_('member', '共通パスワード（組合員用）'); }
function menuSetAdminPassword() { setPasswordFlow_('officer', '管理パスワード（役員用）'); }

// ---------- 組織名 ----------

function menuSetOrg() {
  var items = [
    ['ORG_TITLE', '台帳の見出し', '例：〇〇労働組合 組合員台帳'],
    ['ORG_HONBU', '地方本部', '例：〇〇地方本部'],
    ['ORG_BRANCH', '支部', '例：〇〇支部'],
    ['ORG_BUNKAI', '分会', '例：〇〇分会']
  ];
  for (var i = 0; i < items.length; i++) {
    var it = items[i], now = prop_(it[0]);
    var v = ask_('組織名の設定（' + (i + 1) + '/' + items.length + '）',
      it[1] + 'を入力してください（' + it[2] + '）。' + (now ? '\n今の設定：' + now + '\n空のままOKで変更しません。' : ''));
    if (v === null) return;
    if (v) setProp_(it[0], v.slice(0, 60));
  }
  alert_('組織名の設定', '保存しました。次にログインしたときから台帳の見出しに表示されます。');
}

// ---------- ⑤ Web接続テスト ----------

function menuWebTest() {
  var url = ask_('Web接続テスト', 'デプロイで表示された「ウェブアプリのURL」（…/exec で終わるもの）を貼り付けてください。' +
                 (prop_('WEBAPP_URL') ? '\n空のままOKで前回のURL：\n' + prop_('WEBAPP_URL') : ''));
  if (url === null) return;
  url = url || prop_('WEBAPP_URL') || '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) {
    return alert_('Web接続テスト', 'URLの形が違います。https://script.google.com/macros/s/……/exec の形のURLを貼ってください。');
  }
  setProp_('WEBAPP_URL', url);
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'text/plain', muteHttpExceptions: true,
    payload: JSON.stringify({ action: 'ping' })
  });
  var body = res.getContentText(), data = null;
  try { data = JSON.parse(body); } catch (e) { /* JSONでない＝設定ミス */ }
  if (data && data.ok) {
    alert_('Web接続テスト', '✅ つながりました（バージョン ' + data.data.version + '）\nこのURLを画面側（docs/assets/api.js）に設定します。');
  } else {
    alert_('Web接続テスト', '❌ 返事が正しくありません（HTTP ' + res.getResponseCode() + '）。\n' +
           'デプロイの設定で「アクセスできるユーザー：全員」「次のユーザーとして実行：自分」になっているか確認してください。');
  }
}

// ---------- 自動処理・バックアップ ----------

function menuInstallTriggers() {
  var names = ['dailyBackup', 'notifyPending'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (names.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).inTimezone('Asia/Tokyo').create();
  ScriptApp.newTrigger('notifyPending').timeBased().everyDays(1).atHour(12).inTimezone('Asia/Tokyo').create();
  alert_('自動処理', 'オンにしました。\n・毎日 3時ごろ：バックアップ（' + BACKUP_KEEP_DAYS + '日分を保存）\n' +
         '・毎日12時ごろ：新しい承認待ちがあればLINE通知（LINE設定後に有効）');
}

function menuBackupNow() {
  var name = backupNow_('手動');
  alert_('バックアップ', '作成しました：\n' + name + '\n（マイドライブ「組合員台帳_バックアップ」フォルダ）');
}

// ---------- LINE ----------

function menuConfigureLine() {
  var t = ask_('LINEの設定（1/3）', 'チャネルアクセストークンを貼り付けてください。\nBotが複数あるときは , （半角カンマ）で区切って最大5個。\n空のままOKで変更しません。');
  if (t === null) return;
  if (t) {
    var tokens = t.split(',').map(function (s) { return s.trim(); }).filter(String).slice(0, 5);
    setProp_('LINE_TOKENS', JSON.stringify(tokens));
  }
  var g = ask_('LINEの設定（2/3）', '送信先グループの groupId（C で始まる文字列）を貼り付けてください。\n空のままOKで変更しません。');
  if (g === null) return;
  if (g) {
    if (!/^C[0-9a-f]{32}$/.test(g)) return alert_('LINEの設定', 'groupId の形が違います（C＋32文字）。保存していません。');
    setProp_('LINE_GROUP_ID', g);
  }
  var u = ask_('LINEの設定（3/3）', '（任意）通知に添える管理画面のURL。不要なら空のままOK。');
  if (u === null) return;
  if (u) setProp_('SITE_URL', u);
  alert_('LINEの設定', '保存しました。「LINEにテスト送信」で確かめてください。');
}

function menuLineTest() {
  if (!prop_('LINE_TOKENS') || !prop_('LINE_GROUP_ID')) return alert_('LINE', '先に「LINEの設定」をしてください。');
  var ok = sendLine_([{ type: 'text', text: '【テスト】組合員台帳アプリからの通知テストです。' }]);
  alert_('LINE', ok ? '✅ 送信しました。グループに届いたか確認してください。'
                    : '❌ 送れませんでした。拡張機能 → Apps Script → 左の「実行数」でエラー内容を確認してください。');
}

// ---------- その他 ----------

function menuRevokeAll() {
  var r = ui_().alert('全員をログアウトさせる', 'ログイン中の人（組合員・役員とも）を全員ログアウトさせます。よろしいですか？', ui_().ButtonSet.YES_NO);
  if (r !== ui_().Button.YES) return;
  revokeAllSessions_();
  alert_('全員をログアウトさせる', '完了しました。');
}

function menuStatus() {
  var mark = function (k) { return prop_(k) ? '✅ 設定済み' : '⬜ 未設定'; };
  var triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  var lines = [
    '【設定】（値は表示しません）',
    '初期設定：' + mark('SPREADSHEET_ID'),
    '共通パスワード：' + mark('MEMBER_PASS_HASH'),
    '管理パスワード：' + mark('ADMIN_PASS_HASH'),
    'バックアップ先：' + mark('BACKUP_FOLDER_ID'),
    '組織名：' + mark('ORG_BUNKAI'),
    'LINEトークン：' + (prop_('LINE_TOKENS') ? '✅ ' + JSON.parse(prop_('LINE_TOKENS')).length + '個' : '⬜ 未設定'),
    'LINEグループ：' + mark('LINE_GROUP_ID'),
    'WebアプリURL：' + (prop_('WEBAPP_URL') || '⬜ 未確認'),
    '',
    '【自動処理】',
    '毎日のバックアップ：' + (triggers.indexOf('dailyBackup') >= 0 ? '✅ オン' : '⬜ オフ'),
    '毎日のLINE通知：' + (triggers.indexOf('notifyPending') >= 0 ? '✅ オン' : '⬜ オフ')
  ];
  if (prop_('SPREADSHEET_ID')) {
    lines.push('', '【件数】',
      '台帳：' + activeMembers_().length + '件（ゴミ箱 ' + readAll_('members').filter(isDeleted_).length + '件）',
      '承認待ち：' + readAll_('change_requests').filter(function (r) { return r.status === 'pending'; }).length + '件');
  }
  alert_('設定状況', lines.join('\n'));
}
