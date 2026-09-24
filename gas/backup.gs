/**
 * backup.gs — スプレッドシートのバックアップ
 *
 *  ・毎日1回（時間主導型トリガー）、スプレッドシートを丸ごとコピーして Drive のフォルダに保存
 *  ・BACKUP_KEEP_DAYS 日より古いバックアップはゴミ箱へ
 *  ・保存先フォルダ：スクリプトプロパティ BACKUP_FOLDER_ID（初期設定で自動作成）
 *  ・コピーは自分だけのファイル（共有されていない状態）で作られる
 */

var BACKUP_KEEP_DAYS = 30;
var BACKUP_PREFIX = '組合員台帳_バックアップ_';

/** 今すぐバックアップを1つ作る。作ったファイル名を返す */
function backupNow_(label) {
  var folderId = prop_('BACKUP_FOLDER_ID');
  if (!folderId) throw new Error('BACKUP_FOLDER_ID が未設定です（メニュー「① 初期設定」を実行してください）');
  var name = BACKUP_PREFIX + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm') + (label ? '_' + label : '');
  DriveApp.getFileById(prop_('SPREADSHEET_ID')).makeCopy(name, DriveApp.getFolderById(folderId));
  return name;
}

/** 古いバックアップを消す（このアプリが作ったものだけ） */
function cleanupBackups_() {
  var folder = DriveApp.getFolderById(prop_('BACKUP_FOLDER_ID'));
  var limit = Date.now() - BACKUP_KEEP_DAYS * 86400000, n = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf(BACKUP_PREFIX) === 0 && f.getDateCreated().getTime() < limit) {
      f.setTrashed(true);
      n++;
    }
  }
  return n;
}

/** 時間主導型トリガーから毎日呼ばれる */
function dailyBackup() {
  var name = backupNow_('毎日');
  var removed = cleanupBackups_();
  console.log('バックアップ作成：' + name + ' / 古いものを' + removed + '件削除');
}
