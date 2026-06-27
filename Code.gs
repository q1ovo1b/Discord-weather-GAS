/**
 * ============================================================================
 * 毎朝天気予報 Discord 通知 - Google Apps Script
 * ============================================================================
 *
 * 【概要】
 *   気象庁の天気予報 JSON を取得し、毎朝 Discord チャンネルに
 *   その日の天気を自動投稿する Google Apps Script です。
 *
 *   朝6時台に通常投稿を行うほか、気象庁の11時発表・17時発表を受けて
 *   天気予報に大きな変化があった場合のみ追加通知を行います。
 *
 * 【動作環境】
 *   Google Apps Script（V8 ランタイム）
 *
 * 【データ提供】
 *   気象庁 (https://www.jma.go.jp/bosai/forecast/)
 *
 * 【使い方】
 *   1. GAS プロジェクトを新規作成
 *   2. このコードをすべてコピーして貼り付け
 *   3. スクリプトプロパティに DISCORD_WEBHOOK_URL を設定
 *   4. setupTrigger() を実行してトリガーを設定（6時台・11時台・17時台の3つ）
 *   5. testPost() でテスト投稿、testUpdateCheck() で更新確認をテスト
 *
 *   → 詳しくは README.md を参照してください
 *
 * 【注意】
 *   - Webhook URL は絶対にコードに直書きしないでください
 *   - 気象庁 JSON は公式に安定保証された API ではありません
 *   - 仕様変更時にはコードの修正が必要になる場合があります
 *
 * ライセンス: MIT
 * ============================================================================
 */


// ############################################################################
// 設  定（ここを変更するだけでカスタマイズできます）
// ############################################################################

var CONFIG = {

  // ---- 地域設定 -----------------------------------------------------------
  // 気象庁のエリアコード（都道府県単位の office コード）
  //   130000 = 東京都, 140000 = 神奈川県, 120000 = 千葉県, 110000 = 埼玉県 ...
  //   自分の地域のコードは area.json から調べられます:
  //     https://www.jma.go.jp/bosai/common/const/area.json
  AREA_CODE: '110000',

  // 予報区域コード（class10s レベル、天気・風・降水確率の取得に使用）
  //   110010 = 南部（さいたま市を含む）, 110020 = 北部, 110030 = 秩父地方
  REGION_CODE: '110010',

  // 気温観測地点コード（class20s レベル、気温データの取得に使用）
  //   43241 = さいたま, 43056 = 熊谷, 43156 = 秩父
  TEMP_STATION_CODE: '43241',

  // Discord 投稿に表示する地域名（自由に変更してかまいません）
  //   気象庁の予報区域（class10s）ベースの表示名にすることを推奨します。
  //   気象庁の予報は市区町村単位ではなく「予報区域」単位で発表されるため、
  //   区域名＋対象市区町村 の形式にすると実態と合った表示になります。
  //   例: 「埼玉県南部（春日部・吉川周辺）」
  //   予報区域コード（class10s）は area.json で確認できます:
  //     https://www.jma.go.jp/bosai/common/const/area.json
  REGION_NAME: '埼玉県南部（春日部・吉川周辺）',

  // ---- 投稿設定 -----------------------------------------------------------
  // Discord 投稿文の末尾に気象庁の出典を表示するか
  //   true  = 表示する, false = 表示しない（初期値）
  SHOW_SOURCE_IN_DISCORD: false,

  // ---- トリガー時刻設定 ---------------------------------------------------
  // 通常投稿の時間（毎日この時間台に実行されます）
  MORNING_TRIGGER_HOUR: 6,

  // 更新確認の時間（気象庁の11時発表・17時発表に対応）
  //   これらの時間台に checkUpdate() が呼ばれ、前回投稿から
  //   大きな変化があった場合のみ Discord に追加通知します
  UPDATE_CHECK_HOURS: [11, 17],

  // ---- 変更検出のしきい値 ------------------------------------------------
  // 降水確率の最大値がこの値以上変わったら「大きな変化」とみなす
  POP_CHANGE_THRESHOLD: 30,

  // 最高気温または最低気温がこの値以上変わったら「大きな変化」とみなす
  TEMP_CHANGE_THRESHOLD: 3,

  // ---- 気象庁 API ---------------------------------------------------------
  // 天気予報 JSON の URL テンプレート（通常は変更不要）
  FORECAST_URL: 'https://www.jma.go.jp/bosai/forecast/data/forecast/{AREA_CODE}.json'
};


// ############################################################################
// 気象庁 天気コード → 簡易天気テキスト 対応表
// ############################################################################
// 気象庁の天気コード（weatherCode）を、Discord 投稿向けの短いテキストに変換します。
// ここにないコードが出現した場合は、気象庁の weathers 本文をそのまま使います。

var WEATHER_CODE_MAP = {
  '100': '晴れ',
  '101': '晴れ 時々 くもり',
  '102': '晴れ 一時 雨',
  '103': '晴れ 時々 雨',
  '104': '晴れ 一時 雪',
  '105': '晴れ 時々 雪',
  '110': '晴れ のち くもり',
  '111': '晴れ のち くもり',
  '112': '晴れ のち 一時 雨',
  '113': '晴れ のち 時々 雨',
  '115': '晴れ のち 時々 雪',
  '118': '晴れ のち 雨',
  '119': '晴れ のち 雪',
  '123': '晴れ のち 雨',
  '130': '朝の内 霧 のち 晴れ',
  '200': 'くもり',
  '201': 'くもり 時々 晴れ',
  '202': 'くもり 一時 雨',
  '203': 'くもり 時々 雨',
  '204': 'くもり 一時 雪',
  '205': 'くもり 時々 雪',
  '208': 'くもり 一時 雨',
  '209': 'くもり 時々 雪',
  '210': 'くもり のち 晴れ',
  '211': 'くもり のち 晴れ',
  '212': 'くもり のち 時々 雪',
  '213': 'くもり のち 一時 雨',
  '214': 'くもり のち 時々 雨',
  '215': 'くもり のち 一時 雪',
  '218': 'くもり のち 雨',
  '300': '雨',
  '301': '雨 時々 晴れ',
  '302': '雨 時々 くもり',
  '303': '雨 時々 雪',
  '304': '雨か雪',
  '306': '大雨',
  '308': '雨',
  '309': '雨',
  '311': '雨 のち 晴れ',
  '313': '雨 のち くもり',
  '314': '雨 のち 雪',
  '316': '雨',
  '400': '雪',
  '401': '雪 時々 晴れ',
  '402': '雪 時々 くもり',
  '403': '雪 時々 雨',
  '405': '大雪',
  '406': '風雪 強い',
  '407': '暴風雪'
};


// ============================================================================
// メイン：毎朝のトリガーから実行されるエントリポイント
// ============================================================================

/**
 * 毎朝の天気予報を取得し、Discord に投稿します。
 * 時間主導トリガー（毎日6時台）から自動的に呼び出されます。
 */
function main() {
  try {
    console.log('=== 天気予報 Discord 通知（通常投稿）開始 ===');

    // 1. Webhook URL を取得
    var webhookUrl = getWebhookUrl();

    // 2. 気象庁 JSON を取得
    var data = fetchWeatherJson(CONFIG.AREA_CODE);

    // 3. 天気情報を抽出
    var weatherInfo = buildWeatherInfo(data);

    // 4. Discord 投稿文を作成
    var message = formatDiscordMessage(weatherInfo);

    // 5. Discord に投稿
    postToDiscord(webhookUrl, message);

    // 6. スナップショットを保存（11時・17時の更新確認用）
    saveWeatherSnapshot(weatherInfo);

    console.log('=== 天気予報 Discord 通知（通常投稿）完了 ===');
  } catch (e) {
    console.error('【エラー】main() で例外が発生しました');
    console.error('  message: ' + e.message);
    console.error('  stack: ' + e.stack);
    throw e; // GAS の実行ログにエラーを残す
  }
}


// ============================================================================
// テスト投稿用
// ============================================================================

/**
 * テスト投稿を実行します。
 *
 * 固定のサンプルメッセージではなく、実際に気象庁の天気予報 JSON を取得し、
 * その内容を Discord に投稿します。本番の朝6時台の通常投稿と同じパスを通るため、
 * 設定が正しいか・JSON が取得できるか・投稿文が意図通りかを確認できます。
 *
 * GAS エディタでこの関数を選択して「実行」してください。
 *
 * 更新確認（11時・17時発表）の動作テストには testUpdateCheck() を使ってください。
 */
function testPost() {
  console.log('=== テスト投稿 開始（気象庁 JSON を実際に取得します） ===');
  main();
  console.log('=== テスト投稿 終了 ===');
}


// ============================================================================
// トリガー管理
// ============================================================================

/**
 * 毎日の自動実行トリガーをまとめて作成します。
 * 初回セットアップ時に手動で実行してください。
 *
 * 作成されるトリガー:
 *   1. main():       毎日 6:00〜7:00  → 通常投稿
 *   2. checkUpdate(): 毎日 11:00〜12:00 → 11時発表の更新確認（変化時のみ投稿）
 *   3. checkUpdate(): 毎日 17:00〜18:00 → 17時発表の更新確認（変化時のみ投稿）
 *
 * 既存のトリガーはすべて削除してから作り直します（重複防止）。
 * GAS の仕様上、実行時刻はおおよその目安で、日によって前後します。
 */
function setupTrigger() {
  console.log('=== トリガー設定 開始 ===');

  // 既存のトリガーをすべて削除（重複防止）
  deleteAllTriggers();

  // 1. 毎朝の通常投稿トリガー
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.MORNING_TRIGGER_HOUR)
    .create();
  console.log('  作成: main() — 毎日 ' + CONFIG.MORNING_TRIGGER_HOUR + ':00〜' + (CONFIG.MORNING_TRIGGER_HOUR + 1) + ':00（通常投稿）');

  // 2. 11時台・17時台の更新確認トリガー
  for (var i = 0; i < CONFIG.UPDATE_CHECK_HOURS.length; i++) {
    var hour = CONFIG.UPDATE_CHECK_HOURS[i];
    ScriptApp.newTrigger('checkUpdate')
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
    console.log('  作成: checkUpdate() — 毎日 ' + hour + ':00〜' + (hour + 1) + ':00（更新確認）');
  }

  console.log('');
  console.log('GAS エディタ左メニューの「トリガー」からも確認できます:');
  console.log('  https://script.google.com/home/triggers');
  console.log('=== トリガー設定 完了 ===');
}

/**
 * このスクリプトに設定されているすべてのトリガーを削除します。
 * setupTrigger() から自動的に呼ばれるほか、単独でも実行できます。
 */
function deleteAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  console.log('既存のトリガー数: ' + triggers.length);
  for (var i = 0; i < triggers.length; i++) {
    var funcName = triggers[i].getHandlerFunction();
    ScriptApp.deleteTrigger(triggers[i]);
    console.log('  削除: ' + funcName);
  }
  if (triggers.length === 0) {
    console.log('  削除対象のトリガーはありませんでした');
  }
}


// ============================================================================
// Webhook URL 管理
// ============================================================================

/**
 * スクリプトプロパティから Discord Webhook URL を取得します。
 *
 * Webhook URL は GAS の「スクリプト プロパティ」に保存します。
 * GAS エディタ → 左メニュー「プロジェクトの設定」→「スクリプト プロパティ」
 * プロパティ名: DISCORD_WEBHOOK_URL
 * 値          : https://discord.com/api/webhooks/...
 *
 * @return {string} Discord Webhook URL
 */
function getWebhookUrl() {
  var url = PropertiesService.getScriptProperties().getProperty('DISCORD_WEBHOOK_URL');

  if (!url || url === '') {
    throw new Error(
      'Discord Webhook URL が設定されていません。\n' +
      'GAS エディタで以下の手順を実行してください:\n' +
      '  1. 左メニュー「プロジェクトの設定」を開く\n' +
      '  2. 一番下の「スクリプト プロパティ」を開く\n' +
      '  3. 「行を追加」をクリック\n' +
      '  4. プロパティ: DISCORD_WEBHOOK_URL\n' +
      '  5. 値: Discord の Webhook URL を貼り付け\n' +
      '  6. 「保存」をクリック\n' +
      '詳しくは README.md を参照してください。'
    );
  }

  return url;
}


// ============================================================================
// 気象庁 JSON 取得
// ============================================================================

/**
 * 気象庁の天気予報 JSON を取得します。
 *
 * @param {string} areaCode - 気象庁のエリアコード（例: '110000'）
 * @return {Object} パース済みの JSON データ（配列）
 */
function fetchWeatherJson(areaCode) {
  var url = CONFIG.FORECAST_URL.replace('{AREA_CODE}', areaCode);

  console.log('気象庁 JSON 取得: ' + url);

  var options = {
    method: 'get',
    muteHttpExceptions: true // エラー応答を例外ではなく戻り値で受け取る
  };

  var response = UrlFetchApp.fetch(url, options);
  var statusCode = response.getResponseCode();

  if (statusCode !== 200) {
    throw new Error(
      '気象庁 JSON の取得に失敗しました。\n' +
      '  URL: ' + url + '\n' +
      '  ステータスコード: ' + statusCode + '\n' +
      '  レスポンス: ' + response.getContentText().slice(0, 500)
    );
  }

  var text = response.getContentText('UTF-8');

  // 空レスポンスのチェック
  if (!text || text.trim() === '') {
    throw new Error('気象庁 JSON のレスポンスが空でした。URL: ' + url);
  }

  try {
    var data = JSON.parse(text);
  } catch (e) {
    throw new Error(
      '気象庁 JSON のパースに失敗しました。\n' +
      '  URL: ' + url + '\n' +
      '  エラー: ' + e.message + '\n' +
      '  ※気象庁の JSON 仕様が変更された可能性があります'
    );
  }

  // 戻り値の基本チェック
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('気象庁 JSON の構造が想定と異なります（配列ではありません）。');
  }

  console.log('気象庁 JSON 取得成功');
  if (data[0] && data[0].reportDatetime) {
    console.log('  発表時刻: ' + data[0].reportDatetime);
    console.log('  発表官署: ' + (data[0].publishingOffice || '不明'));
  }

  return data;
}


// ============================================================================
// 日付ユーティリティ
// ============================================================================

/**
 * 今日の日付を JST（日本時間）で "yyyy-MM-dd" 形式で返します。
 * @return {string} 今日の日付文字列（例: "2026-06-27"）
 */
function getTodayDateJst() {
  return Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
}

/**
 * Date オブジェクトから曜日を日本語で返します。
 * @param {Date} date - 日付オブジェクト
 * @return {string} 曜日（"月"〜"日"）
 */
function getDayOfWeekJp(date) {
  var days = ['日', '月', '火', '水', '木', '金', '土'];
  return days[date.getDay()];
}

/**
 * 気象庁の発表日時（ISO 8601）を Discord 投稿向けにフォーマットします。
 * 例: "2026-06-27T11:00:00+09:00" → "2026年6月27日 11:00"
 *
 * @param {string} isoString - ISO 8601 日時文字列
 * @return {string} フォーマット済みの日時文字列。パース失敗時は元の文字列
 */
function formatReportDatetime(isoString) {
  if (!isoString || typeof isoString !== 'string') return '';

  // "2026-06-27T11:00:00+09:00" → ["2026-06-27", "11:00"]
  var parts = isoString.split('T');
  if (parts.length < 2) return isoString;

  var datePart = parts[0];  // "2026-06-27"
  var timePart = parts[1].substring(0, 5); // "11:00"

  var dateSegments = datePart.split('-');
  if (dateSegments.length !== 3) return isoString;

  var year  = parseInt(dateSegments[0], 10);
  var month = parseInt(dateSegments[1], 10);
  var day   = parseInt(dateSegments[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return isoString;

  return year + '年' + month + '月' + day + '日 ' + timePart;
}

/**
 * 発表日時と発表官署から Discord 投稿用の「発表」行を作成します。
 * 例: "発表：2026年6月27日 11:00（熊谷地方気象台）"
 *
 * @param {string} reportDatetime - 気象庁の発表日時（ISO 8601）
 * @param {string} publishingOffice - 発表官署名
 * @return {string} フォーマット済みの発表行。日時が無効な場合は空文字列
 */
function formatReportLine(reportDatetime, publishingOffice) {
  var formatted = formatReportDatetime(reportDatetime);
  if (!formatted) return '';

  var line = '発表：' + formatted;
  if (publishingOffice) {
    line += '（' + publishingOffice + '）';
  }
  return line;
}


// ============================================================================
// 気象情報の抽出
// ============================================================================

/**
 * 気象庁の JSON から今日の天気情報を抽出し、扱いやすいオブジェクトにまとめます。
 *
 * JSON 構造の詳細な説明はコード内コメントと README.md を参照。
 * 気象庁 JSON の仕様変更に備え、各項目の存在チェックを丁寧に行います。
 *
 * @param {Array} data - fetchWeatherJson() で取得した JSON データ
 * @return {Object} 抽出された天気情報
 */
function buildWeatherInfo(data) {
  // data[0] = 今日・明日・明後日の予報
  // data[1] = 週間予報（補助的に使用）
  var shortForecast = data[0];
  var weeklyForecast = data[1] || null;

  if (!shortForecast || !Array.isArray(shortForecast.timeSeries)) {
    throw new Error('気象庁 JSON（短期予報）の構造が想定と異なります。');
  }

  var timeSeries = shortForecast.timeSeries;

  // 各時系列データを抽出（最低 3 つの timeSeries が必要）
  if (timeSeries.length < 3) {
    throw new Error(
      '気象庁 JSON の timeSeries が不足しています（' +
      timeSeries.length + '件）。最低 3 件必要です。'
    );
  }

  // --- 天気・風情報（timeSeries[0]）---
  var weatherWind = extractWeatherWind(timeSeries[0]);

  // --- 降水確率（timeSeries[1]）---
  var pops = extractPrecipitationProb(timeSeries[1]);

  // --- 気温（timeSeries[2]）---
  var temps = extractTemperatures(timeSeries[2]);

  // --- 週間予報から補足（短期予報で不足する場合のフォールバック）---
  if (weeklyForecast && weeklyForecast.timeSeries) {
    // 気温が取得できなかった場合、週間予報から補完を試みる
    if (temps.maxTemp === null || temps.minTemp === null) {
      var weeklyTemps = extractTempsFromWeekly(weeklyForecast.timeSeries);
      if (temps.maxTemp === null) temps.maxTemp = weeklyTemps.maxTemp;
      if (temps.minTemp === null) temps.minTemp = weeklyTemps.minTemp;
    }
  }

  // --- 服装の目安 ---
  var clothing = getClothingAdvice({
    weatherText: weatherWind.weatherText,
    maxTemp: temps.maxTemp,
    minTemp: temps.minTemp,
    maxPop: pops.maxPop !== null ? pops.maxPop : 0,
    windText: weatherWind.windText
  });

  // --- 雨のピーク情報 ---
  var rainPeakResult = getRainPeakInfo(pops, weatherWind.weatherRaw);

  // --- 結果をまとめる ---
  return {
    reportDatetime: shortForecast.reportDatetime || null,
    publishingOffice: shortForecast.publishingOffice || null,
    regionName: CONFIG.REGION_NAME,
    weatherText: weatherWind.weatherText,     // 今日の天気（テキスト）
    weatherCode: weatherWind.weatherCode,     // 今日の天気コード
    windText: weatherWind.windText,           // 風の情報
    maxTemp: temps.maxTemp,                   // 今日の最高気温（数値）
    minTemp: temps.minTemp,                   // 今日の最低気温（数値）
    popsToday: pops.today,                    // 今日の降水確率（時間帯別）
    maxPop: pops.maxPop,                      // 今日の最大降水確率（数値）
    rainPeak: rainPeakResult.peak,            // 雨のピーク時間帯の説明（時間範囲付き）
    rainPeakSupplement: rainPeakResult.supplement, // 天気文から抽出した補足
    clothingAdvice: clothing,                  // 服装の目安
    // 以下は将来的な拡張用。現状の気象庁 JSON だけでは取得困難なため null
    humidity: null,                           // 湿度（気象庁JSON単独では取得不可）
    uvIndex: null                             // UVインデックス（気象庁JSON単独では取得不可）
  };
}


/**
 * timeSeries[0] から天気テキスト、天気コード、風情報を抽出します。
 *
 * timeSeries[0] の構造:
 *   timeDefines: [今日11:00, 明日00:00, 明後日00:00]
 *   areas: [{ area: {name, code}, weatherCodes: [3個], weathers: [3個], winds: [3個] }]
 *
 * @param {Object} ts - timeSeries[0]
 * @return {Object} {weatherText, weatherCode, windText, weatherRaw}
 */
function extractWeatherWind(ts) {
  // 今日の日付に一致するインデックスを探す
  var idx = findTodayIndex(ts.timeDefines);

  // 該当する予報区域を探す
  var area = findArea(ts.areas, CONFIG.REGION_CODE);

  if (!area) {
    throw new Error(
      '予報区域コード ' + CONFIG.REGION_CODE + ' が見つかりませんでした。\n' +
      'REGION_CODE の設定を確認してください。\n' +
      '利用可能な区域: ' + ts.areas.map(function(a) {
        return a.area.name + '(' + a.area.code + ')';
      }).join(', ')
    );
  }

  var weatherCode = getArrayValue(area.weatherCodes, idx);
  var weatherRaw  = getArrayValue(area.weathers, idx);
  var windRaw     = getArrayValue(area.winds, idx);

  // 天気コード → 簡易テキスト変換。未定義コードの場合は weathers の本文を利用
  var weatherText = '';
  if (weatherCode && WEATHER_CODE_MAP[weatherCode]) {
    weatherText = WEATHER_CODE_MAP[weatherCode];
  } else if (weatherRaw) {
    // weathers 本文から簡易化（所により〜などの詳細を省く）
    weatherText = simplifyWeatherText(weatherRaw);
  } else {
    weatherText = '不明';
  }

  // 風テキストの整形（全角スペースを半角に）
  var windText = windRaw ? windRaw.replace(/　/g, ' ') : '不明';

  return {
    weatherText: weatherText,
    weatherCode: weatherCode || null,
    windText: windText,
    weatherRaw: weatherRaw || ''
  };
}


/**
 * timeSeries[1] から今日の降水確率を抽出します。
 *
 * timeSeries[1] の構造:
 *   timeDefines: [今日12:00, 今日18:00, 明日00:00, 明日06:00, 明日12:00, 明日18:00]
 *   areas: [{ area: {name, code}, pops: [6個] }]
 *
 * 各要素は6時間間隔。例: 12:00 は 12:00〜18:00 の降水確率を表します。
 *
 * @param {Object} ts - timeSeries[1]
 * @return {Object} {today: [{period, value}], maxPop: number|null}
 */
function extractPrecipitationProb(ts) {
  var area = findArea(ts.areas, CONFIG.REGION_CODE);

  if (!area || !area.pops) {
    console.warn('降水確率データが見つかりませんでした（REGION_CODE: ' + CONFIG.REGION_CODE + '）');
    return { today: [], maxPop: null };
  }

  var todayDate = getTodayDateJst();
  var pops = area.pops;
  var timeDefines = ts.timeDefines || [];

  // 各 pops の日付を判定し、今日のものだけを抽出
  var todayPops = [];
  var maxPop = null;

  for (var i = 0; i < pops.length && i < timeDefines.length; i++) {
    var popValue = parseInt(pops[i], 10);
    if (isNaN(popValue)) continue; // 空文字列などの場合はスキップ

    var timeStr = timeDefines[i];
    var dateStr = extractDateFromIso(timeStr);

    if (dateStr === todayDate) {
      var periodLabel = getTimePeriodLabel(timeStr);
      todayPops.push({ period: periodLabel, value: popValue });

      if (maxPop === null || popValue > maxPop) {
        maxPop = popValue;
      }
    }
  }

  return { today: todayPops, maxPop: maxPop };
}


/**
 * timeSeries[2] から今日の最高・最低気温を抽出します。
 *
 * timeSeries[2] の構造:
 *   timeDefines: [今日09:00, 今日00:00, 明日00:00, 明日09:00]
 *   areas: [{ area: {name, code}, temps: [4個] }]
 *
 * 慣例として、同一日付の中で:
 *   - 09:00 の timeDefine → 最高気温
 *   - 00:00 の timeDefine → 最低気温
 * として解釈します。
 *
 * 今日の日付のデータから両方取得できなかった場合は、
 * 片方だけでもあればそれを返し、なければ両方 null とします。
 * 他日のデータをフォールバックとして使うことはしません（誤表示防止）。
 *
 * @param {Object} ts - timeSeries[2]
 * @return {Object} {maxTemp: number|null, minTemp: number|null}
 */
function extractTemperatures(ts) {
  var area = findArea(ts.areas, CONFIG.TEMP_STATION_CODE);

  if (!area || !area.temps) {
    console.warn(
      '気温データが見つかりませんでした（TEMP_STATION_CODE: ' +
      CONFIG.TEMP_STATION_CODE + '）'
    );
    return { maxTemp: null, minTemp: null };
  }

  var todayDate = getTodayDateJst();
  var temps = area.temps;
  var timeDefines = ts.timeDefines || [];

  var maxTemp = null;
  var minTemp = null;
  var todayMaxCandidates = [];
  var todayMinCandidates = [];

  // 今日の日付のデータを収集
  for (var i = 0; i < temps.length && i < timeDefines.length; i++) {
    var tempValue = parseFloat(temps[i]);
    if (isNaN(tempValue)) continue;

    var timeStr = timeDefines[i];
    var dateStr = extractDateFromIso(timeStr);

    if (dateStr === todayDate) {
      // 時刻から最高/最低を判断（09:00 含む → 最高、それ以外 → 最低）
      if (timeStr.indexOf('T09:') !== -1) {
        todayMaxCandidates.push(tempValue);
      } else {
        todayMinCandidates.push(tempValue);
      }
    }
  }

  // 今日の 09:00 データから最高気温を決定（複数ある場合は最も高い値）
  if (todayMaxCandidates.length > 0) {
    maxTemp = Math.max.apply(null, todayMaxCandidates);
  }

  // 今日の 00:00 データから最低気温を決定（複数ある場合は最も低い値）
  if (todayMinCandidates.length > 0) {
    minTemp = Math.min.apply(null, todayMinCandidates);
  }

  // 今日の日付のデータが1つもない場合のログ
  if (todayMaxCandidates.length === 0 && todayMinCandidates.length === 0) {
    console.warn(
      '今日（' + todayDate + '）の気温データが timeSeries[2] に見つかりませんでした。' +
      '利用可能な日付: ' + timeDefines.map(function(td) {
        return extractDateFromIso(td);
      }).join(', ')
    );
  }

  return { maxTemp: maxTemp, minTemp: minTemp };
}


/**
 * 週間予報から今日の最高・最低気温を補完取得します（短期予報で取得できない場合のフォールバック）。
 *
 * 週間予報 timeSeries[1] の構造:
 *   timeDefines: [7日分の日付]
 *   areas: [{ area: {name, code}, tempsMax: [7個], tempsMin: [7個] }]
 *
 * @param {Array} weeklyTimeSeries - weeklyForecast.timeSeries
 * @return {Object} {maxTemp, minTemp}
 */
function extractTempsFromWeekly(weeklyTimeSeries) {
  // 週間気温は timeSeries[1]
  var ts = weeklyTimeSeries.length >= 2 ? weeklyTimeSeries[1] : null;
  if (!ts || !ts.timeDefines || !ts.areas) {
    return { maxTemp: null, minTemp: null };
  }

  var todayDate = getTodayDateJst();
  var area = ts.areas[0]; // 週間予報は通常 1 エリア
  if (!area) return { maxTemp: null, minTemp: null };

  var idx = -1;
  for (var i = 0; i < ts.timeDefines.length; i++) {
    if (extractDateFromIso(ts.timeDefines[i]) === todayDate) {
      idx = i;
      break;
    }
  }

  if (idx < 0) return { maxTemp: null, minTemp: null };

  var maxTemp = null;
  var minTemp = null;

  if (area.tempsMax && area.tempsMax.length > idx) {
    maxTemp = parseFloat(area.tempsMax[idx]);
    if (isNaN(maxTemp)) maxTemp = null;
  }
  if (area.tempsMin && area.tempsMin.length > idx) {
    minTemp = parseFloat(area.tempsMin[idx]);
    if (isNaN(minTemp)) minTemp = null;
  }

  return { maxTemp: maxTemp, minTemp: minTemp };
}


// ============================================================================
// JSON 構造探索ユーティリティ
// ============================================================================

/**
 * areas 配列から指定コードのエリアオブジェクトを検索します。
 * @param {Array} areas - エリアオブジェクトの配列
 * @param {string} code - 検索するエリアコード
 * @return {Object|null} 見つかったエリアオブジェクト、または null
 */
function findArea(areas, code) {
  if (!areas || !Array.isArray(areas)) return null;

  for (var i = 0; i < areas.length; i++) {
    if (areas[i] && areas[i].area && areas[i].area.code === code) {
      return areas[i];
    }
  }
  return null;
}

/**
 * timeDefines 配列の中で、今日の日付に一致する最初のインデックスを返します。
 * 見つからない場合は 0 を返します（安全フォールバック）。
 *
 * @param {Array<string>} timeDefines - ISO 8601 日時文字列の配列
 * @return {number} マッチするインデックス
 */
function findTodayIndex(timeDefines) {
  if (!timeDefines || !Array.isArray(timeDefines) || timeDefines.length === 0) {
    return 0;
  }

  var todayDate = getTodayDateJst();

  for (var i = 0; i < timeDefines.length; i++) {
    if (extractDateFromIso(timeDefines[i]) === todayDate) {
      return i;
    }
  }

  // 今日の日付が見つからなければ、安全のため 0 を返す
  console.warn(
    '今日の日付（' + todayDate + '）に一致する timeDefine がありませんでした。' +
    '最初のエントリを使用します。利用可能な日付: ' + timeDefines.join(', ')
  );
  return 0;
}

/**
 * ISO 8601 形式の日時文字列から日付部分（yyyy-MM-dd）を抽出します。
 * 例: "2026-06-27T11:00:00+09:00" → "2026-06-27"
 *
 * @param {string} isoString - ISO 8601 日時文字列
 * @return {string} 日付文字列
 */
function extractDateFromIso(isoString) {
  if (!isoString || typeof isoString !== 'string') return '';
  // "T" より前の部分が日付
  var tIndex = isoString.indexOf('T');
  return tIndex > 0 ? isoString.substring(0, tIndex) : isoString;
}

/**
 * 配列の指定インデックスの値を安全に取得します。
 * インデックスが範囲外または値が空文字列の場合は null を返します。
 *
 * @param {Array} arr - 対象配列
 * @param {number} idx - インデックス
 * @return {*|null} 値、または null
 */
function getArrayValue(arr, idx) {
  if (!arr || !Array.isArray(arr)) return null;
  if (idx < 0 || idx >= arr.length) return null;
  var val = arr[idx];
  // 空文字列は null 扱い
  if (typeof val === 'string' && val.trim() === '') return null;
  return val;
}


// ============================================================================
// 天気テキストの簡易化
// ============================================================================

/**
 * 気象庁の weathers 本文を Discord 投稿向けに簡易化します。
 *
 * 気象庁の weathers は次のような長いテキストです:
 *   "雨　時々　くもり　所により　夕方　から　夜のはじめ頃　雷を伴い　激しく　降る"
 *
 * 「所により」以降の詳細な地域的注釈を省き、主要な天気概況だけを抜き出します。
 * 全角スペースは半角スペースに変換します。
 *
 * @param {string} rawText - 気象庁の天気本文
 * @return {string} 簡易化された天気テキスト
 */
function simplifyWeatherText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '不明';

  // 全角スペース → 半角スペース
  var text = rawText.replace(/　/g, ' ');

  // 「所により」以降をカット
  var tokoroIndex = text.indexOf('所により');
  if (tokoroIndex > 0) {
    text = text.substring(0, tokoroIndex).trim();
  }

  return text;
}

/**
 * ISO 8601 日時文字列の時刻から、降水確率の時間帯ラベルを返します。
 *
 * 6時間間隔の開始時刻を基に:
 *   00:00 → "未明"
 *   06:00 → "午前"
 *   12:00 → "午後"
 *   18:00 → "夜"
 *
 * @param {string} isoString - ISO 8601 日時文字列
 * @return {string} 時間帯ラベル
 */
function getTimePeriodLabel(isoString) {
  if (!isoString) return '';

  // "T" の後の時刻部分を抽出（例: "T12:00:00+09:00" → "12"）
  var tIndex = isoString.indexOf('T');
  if (tIndex < 0) return '';

  var hourStr = isoString.substring(tIndex + 1, tIndex + 3);
  var hour = parseInt(hourStr, 10);

  if (hour >= 0 && hour < 6)  return '未明';
  if (hour >= 6 && hour < 12) return '午前';
  if (hour >= 12 && hour < 18) return '午後';
  return '夜';
}


// ============================================================================
// 雨のピーク判定
// ============================================================================

/**
 * 時間帯ラベルに対応する時間範囲を返します。
 * @param {string} period - 時間帯ラベル（"未明", "朝", "午前", "午後", "夜"）
 * @return {string} 時間範囲文字列（例: "0〜6時ごろ"）。該当なしの場合は ""
 */
function getTimeRangeForPeriod(period) {
  switch (period) {
    case '未明': return '0〜6時ごろ';
    case '朝':   // fallthrough - 「朝」と「午前」は同じ範囲
    case '午前': return '6〜12時ごろ';
    case '午後': return '12〜18時ごろ';
    case '夜':   return '18〜24時ごろ';
    default:     return '';
  }
}

/**
 * 天気概況文（weathers）から、降水に関する時間的補足説明を抽出します。
 *
 * 気象庁の weathers 本文には次のような詳細表現が含まれることがあります:
 *   "所により　夕方　から　夜のはじめ頃　雷を伴い　激しく　降る"
 *
 * この関数は「所により」以降の部分から、時間に関する表現を抽出し、
 * 自然な日本語の補足文を作成します。
 *
 * @param {string} weatherRaw - 気象庁の天気本文（全角スペース混じり）
 * @return {string} 補足説明文。抽出できなかった場合は ""
 */
function extractWeatherSupplement(weatherRaw) {
  if (!weatherRaw || typeof weatherRaw !== 'string') return '';

  // 全角スペース → 半角スペース
  var text = weatherRaw.replace(/　/g, ' ');

  // 「所により」以降を取得
  var tokoroIndex = text.indexOf('所により');
  if (tokoroIndex < 0) return '';

  var detail = text.substring(tokoroIndex).trim();

  // 時間に関するキーワードのリスト（JMA でよく使われる表現）
  var timeKeywords = [
    '明け方', '朝', '昼前', '昼過ぎ', '夕方',
    '夜のはじめ頃', '夜遅く', '未明', '明け方から朝',
    '夕方から夜のはじめ頃', '夜遅くから未明', '昼過ぎから夕方',
    '夜のはじめ頃から夜遅く'
  ];

  var foundPhrases = [];
  // 長いフレーズから先にマッチさせる（部分マッチを避けるため）
  var sortedKeywords = timeKeywords.slice().sort(function(a, b) {
    return b.length - a.length;
  });

  var remaining = detail;
  for (var i = 0; i < sortedKeywords.length; i++) {
    var kw = sortedKeywords[i];
    if (remaining.indexOf(kw) !== -1) {
      foundPhrases.push(kw);
      remaining = remaining.replace(kw, ''); // マッチ済み部分を除去（重複防止）
    }
  }

  if (foundPhrases.length === 0) return '';

  // 強さに関する表現をチェック
  var hasStrong = detail.indexOf('激しく') !== -1;
  var hasVeryStrong = detail.indexOf('非常に激しく') !== -1 || detail.indexOf('猛烈') !== -1;
  var hasThunder = detail.indexOf('雷') !== -1;

  var prefix = '';
  // 見つかった時間フレーズを「〜」区切りで連結
  // ただし元の順序をある程度保つため、最初に見つかったフレーズを使う
  var timePart = foundPhrases[0]; // 最も長くマッチしたフレーズ

  // 強さの修飾
  if (hasVeryStrong) {
    prefix = timePart + 'に非常に激しく降る可能性があります';
  } else if (hasStrong) {
    prefix = timePart + 'に強く降る可能性があります';
  } else if (hasThunder) {
    prefix = timePart + 'に雷を伴う可能性があります';
  } else {
    prefix = timePart + 'に降りやすくなる可能性があります';
  }

  return prefix;
}

/**
 * 降水確率データから雨のピーク時間帯を判定します。
 *
 * 時間帯ラベル（午前・午後・夜・未明）に加えて、
 * その時間帯の実際の時間範囲（例: 12〜18時ごろ）も表示します。
 * また、天気概況文から降水の時間的補足があれば合わせて返します。
 *
 * 【注意】降水量そのものではなく降水確率ベースの推定です。
 * 気象庁の無料 JSON では時間帯別の降水量（mm）は提供されていません。
 *
 * @param {Object} pops - extractPrecipitationProb() の戻り値
 * @param {string} weatherRaw - 気象庁の天気本文（補足抽出用）
 * @return {Object} {peak: string, supplement: string}
 *   peak: Discord 投稿用の雨のピーク行。
 *         例: "午後・夜（12〜24時ごろ、降水確率 60%）"
 *         maxPop < 30 の場合は "雨の心配は小さめです"
 *         データがない場合は ""
 *   supplement: 天気概況文から抽出した補足。例: "夕方に強く降る可能性があります"
 *         抽出できなかった場合は ""
 */
function getRainPeakInfo(pops, weatherRaw) {
  var todayPops = pops.today || [];

  if (todayPops.length === 0) {
    return { peak: '', supplement: '' };
  }

  // 最大の降水確率を探す
  var maxPop = 0;
  for (var i = 0; i < todayPops.length; i++) {
    if (todayPops[i].value > maxPop) {
      maxPop = todayPops[i].value;
    }
  }

  // 全体的に降水確率が低い場合（最大 30% 未満）
  if (maxPop < 30) {
    return { peak: '雨の心配は小さめです', supplement: '' };
  }

  // 最大確率と同率の時間帯をすべて集める
  var peakPeriods = [];
  var timeRanges = [];
  for (var j = 0; j < todayPops.length; j++) {
    if (todayPops[j].value === maxPop) {
      peakPeriods.push(todayPops[j].period);
      var range = getTimeRangeForPeriod(todayPops[j].period);
      if (range !== '') {
        timeRanges.push(range);
      }
    }
  }

  if (peakPeriods.length === 0) {
    return { peak: '', supplement: '' };
  }

  // 時間範囲をマージ（例: "12〜18時ごろ" と "18〜24時ごろ" → "12〜24時ごろ"）
  var rangeStr = mergeTimeRanges(timeRanges);

  var peak = peakPeriods.join('・') + '（' + rangeStr + '、降水確率 ' + maxPop + '%）';

  // 天気概況文から補足を抽出
  var supplement = extractWeatherSupplement(weatherRaw || '');

  return { peak: peak, supplement: supplement };
}

/**
 * 複数の時間範囲文字列を1つにマージします。
 * 例: ["12〜18時ごろ", "18〜24時ごろ"] → "12〜24時ごろ"
 *     ["12〜18時ごろ"] → "12〜18時ごろ"
 *
 * @param {Array<string>} ranges - getTimeRangeForPeriod() の戻り値の配列
 * @return {string} マージされた時間範囲文字列
 */
function mergeTimeRanges(ranges) {
  if (ranges.length === 0) return '';
  if (ranges.length === 1) return ranges[0];

  // 各範囲の開始・終了時刻を数値で取得
  var numbers = [];
  for (var i = 0; i < ranges.length; i++) {
    // "12〜18時ごろ" → ["12", "18"]
    var match = ranges[i].match(/(\d+)〜(\d+)時ごろ/);
    if (match) {
      numbers.push({
        start: parseInt(match[1], 10),
        end: parseInt(match[2], 10)
      });
    }
  }

  if (numbers.length === 0) return ranges.join('・');

  // 最小の開始と最大の終了を取る
  var minStart = numbers[0].start;
  var maxEnd = numbers[0].end;
  for (var j = 1; j < numbers.length; j++) {
    if (numbers[j].start < minStart) minStart = numbers[j].start;
    if (numbers[j].end > maxEnd) maxEnd = numbers[j].end;
  }

  // 24時の扱い: 24時は便宜上 24 のまま
  return minStart + '〜' + maxEnd + '時ごろ';
}


// ============================================================================
// 服装の目安
// ============================================================================

/**
 * 気温・天気・風・降水確率から簡易的な服装の目安を推定します。
 *
 * 【注意】これは気温と天気からの簡易推定であり、実際の体感とは異なる場合があります。
 * 外部 API は使用せず、気象庁 JSON から得られる基本情報のみで判定しています。
 *
 * 判定基準（最高気温ベース）:
 *   30℃以上 → かなり暑い。薄手・熱中症対策を
 *   25〜29℃  → 半袖中心
 *   20〜24℃  → 薄手の長袖または半袖＋羽織り
 *   15〜19℃  → 長袖＋軽い上着
 *   10〜14℃  → 上着が必要
 *   10℃未満  → 防寒が必要
 *
 * 補足条件:
 *   降水確率が高い → 傘を推奨
 *   風が強い       → 風を通しにくい上着を推奨
 *
 * @param {Object} params - {weatherText, maxTemp, minTemp, maxPop, windText}
 * @return {string} 服装の目安テキスト
 */
function getClothingAdvice(params) {
  var weatherText = params.weatherText || '';
  var maxTemp     = params.maxTemp;
  var minTemp     = params.minTemp;
  var maxPop      = params.maxPop || 0;
  var windText    = params.windText || '';

  var advices = [];

  // --- 気温ベースの服装 ---
  if (maxTemp !== null && !isNaN(maxTemp)) {
    if (maxTemp >= 30) {
      advices.push('かなり暑くなりそうです。薄手の服装で、熱中症対策を忘れずに');
    } else if (maxTemp >= 25) {
      advices.push('半袖中心でよさそうです');
    } else if (maxTemp >= 20) {
      advices.push('薄手の長袖か、半袖＋羽織りがよさそうです');
    } else if (maxTemp >= 15) {
      advices.push('長袖＋軽い上着があると安心です');
    } else if (maxTemp >= 10) {
      advices.push('上着が必要です。やや厚手のものがおすすめです');
    } else {
      advices.push('冷え込みます。防寒着を用意してください');
    }
  }

  // 朝晩と日中の寒暖差が大きい場合の補足
  if (maxTemp !== null && minTemp !== null && !isNaN(maxTemp) && !isNaN(minTemp)) {
    var diff = maxTemp - minTemp;
    if (diff >= 10) {
      advices.push('朝晩と日中の寒暖差が大きいので、調節しやすい服装がおすすめです');
    }
  }

  // --- 降水確率ベースの傘推奨 ---
  if (maxPop >= 50) {
    // 降水確率 50% 以上 → 傘推奨
    if (maxPop >= 80) {
      advices.push('雨が降りやすいので、傘をお忘れなく');
    } else {
      advices.push('雨の可能性があるので、折りたたみ傘があると安心です');
    }
  } else if (maxPop >= 30) {
    // 天気文言に「雨」が含まれている場合のみ軽く言及
    if (weatherText.indexOf('雨') !== -1) {
      advices.push('折りたたみ傘があると安心かもしれません');
    }
  }

  // --- 風ベースのアドバイス ---
  var windLevel = getWindLevel(windText);
  if (windLevel === 'strong' || windLevel === 'veryStrong') {
    advices.push('風が強いので、風を通しにくい上着がおすすめです');
  }

  // 結果を連結
  if (advices.length === 0) {
    return '服装の目安は特にありません';
  }

  return advices.join('。') + '。';
}

/**
 * 風テキストから風の強さレベルを判定します。
 * @param {string} windText - 風の説明テキスト
 * @return {string} 'calm' | 'normal' | 'strong' | 'veryStrong'
 */
function getWindLevel(windText) {
  if (!windText) return 'normal';

  if (windText.indexOf('非常に強く') !== -1 || windText.indexOf('暴風') !== -1) {
    return 'veryStrong';
  }
  if (windText.indexOf('強く') !== -1 || windText.indexOf('強風') !== -1) {
    return 'strong';
  }
  return 'normal';
}


// ============================================================================
// Discord 投稿文の作成
// ============================================================================

/**
 * 抽出した天気情報から Discord 投稿用のメッセージ本文を作成します。
 *
 * 投稿文はできるだけ短く、見やすくします。
 * 値が取得できなかった項目は自然に省略します（「不明」と表示しません）。
 *
 * @param {Object} info - buildWeatherInfo() の戻り値
 * @return {string} Discord 投稿用メッセージ
 */
function formatDiscordMessage(info) {
  var now = new Date();
  var dateStr = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy年M月d日');
  var dayOfWeek = getDayOfWeekJp(now);
  var lines = [];

  // ---- ヘッダー ----
  lines.push(dateStr + '（' + dayOfWeek + '）の天気');
  lines.push('');

  // ---- 地域 ----
  lines.push('地域：' + (info.regionName || CONFIG.REGION_NAME));

  // ---- 天気 ----
  if (info.weatherText) {
    lines.push('天気：' + info.weatherText);
  }

  // ---- 降水確率 ----
  if (info.popsToday && info.popsToday.length > 0) {
    var popParts = [];
    for (var i = 0; i < info.popsToday.length; i++) {
      popParts.push(info.popsToday[i].period + ' ' + info.popsToday[i].value + '%');
    }
    lines.push('降水確率：' + popParts.join(' / '));
  }

  // ---- 雨のピーク ----
  if (info.rainPeak && info.rainPeak !== '') {
    lines.push('雨のピーク：' + info.rainPeak);
  }

  // ---- 雨の補足（天気概況文から抽出） ----
  if (info.rainPeakSupplement && info.rainPeakSupplement !== '') {
    lines.push('補足：' + info.rainPeakSupplement);
  }

  // ---- 気温 ----
  //   最高・最低の両方が取得できて値が異なる場合は「最高 X℃ / 最低 Y℃」、
  //   両方取得できて値が同じ場合は「X℃前後」、
  //   片方しか取得できなかった場合も「X℃前後」と表示し、
  //   どちらも取得できなかった場合は行ごと省略します。
  if (info.maxTemp !== null && info.minTemp !== null) {
    if (info.maxTemp !== info.minTemp) {
      lines.push('気温：最高 ' + info.maxTemp + '℃ / 最低 ' + info.minTemp + '℃');
    } else {
      lines.push('気温：' + info.maxTemp + '℃前後');
    }
  } else if (info.maxTemp !== null) {
    lines.push('気温：' + info.maxTemp + '℃前後');
  } else if (info.minTemp !== null) {
    lines.push('気温：' + info.minTemp + '℃前後');
  }

  // ---- 風 ----
  if (info.windText && info.windText !== '') {
    lines.push('風：' + info.windText);
  }

  // ---- 服装目安 ----
  if (info.clothingAdvice) {
    lines.push('');
    lines.push('服装目安：' + info.clothingAdvice);
  }

  // ---- 出典（任意） ----
  if (CONFIG.SHOW_SOURCE_IN_DISCORD) {
    lines.push('');
    lines.push('出典：気象庁 (https://www.jma.go.jp/bosai/forecast/)');
  }

  // ---- 発表時刻（ログ用。Discord には表示しません） ----
  if (info.reportDatetime) {
    console.log('  気象庁発表時刻: ' + info.reportDatetime);
    if (info.publishingOffice) {
      console.log('  発表官署: ' + info.publishingOffice);
    }
  }

  return lines.join('\n');
}


// ============================================================================
// 更新通知メッセージの作成（11時・17時発表用）
// ============================================================================

/**
 * 更新通知用の Discord 投稿文を作成します。
 * 通常投稿より簡潔にし、変更点を冒頭に表示します。
 *
 * @param {Object} info - buildWeatherInfo() の戻り値
 * @param {Array<string>} changes - 変化の説明文の配列
 * @return {string} Discord 投稿用メッセージ
 */
function formatUpdateMessage(info, changes) {
  var lines = [];

  // ---- ヘッダー ----
  lines.push('## 天気予報の更新');
  lines.push('');

  // ---- 地域 ----
  lines.push('地域：' + (info.regionName || CONFIG.REGION_NAME));

  // ---- 変更点 ----
  if (changes.length > 0) {
    lines.push('変更点：' + changes.join('。') + '。');
  }

  lines.push('');

  // ---- 天気 ----
  if (info.weatherText) {
    lines.push('天気：' + info.weatherText);
  }

  // ---- 降水確率 ----
  if (info.popsToday && info.popsToday.length > 0) {
    var popParts = [];
    for (var i = 0; i < info.popsToday.length; i++) {
      popParts.push(info.popsToday[i].period + ' ' + info.popsToday[i].value + '%');
    }
    lines.push('降水確率：' + popParts.join(' / '));
  }

  // ---- 雨のピーク（簡潔に時間帯のみ） ----
  var peakPeriods = extractPeakPeriods(info.popsToday, info.maxPop);
  if (peakPeriods !== '') {
    lines.push('雨のピーク：' + peakPeriods);
  }

  // ---- 気温 ----
  if (info.maxTemp !== null && info.minTemp !== null) {
    if (info.maxTemp !== info.minTemp) {
      lines.push('気温：最高 ' + info.maxTemp + '℃ / 最低 ' + info.minTemp + '℃');
    } else {
      lines.push('気温：' + info.maxTemp + '℃前後');
    }
  } else if (info.maxTemp !== null) {
    lines.push('気温：' + info.maxTemp + '℃前後');
  } else if (info.minTemp !== null) {
    lines.push('気温：' + info.minTemp + '℃前後');
  }

  // ---- 風 ----
  if (info.windText && info.windText !== '') {
    lines.push('風：' + info.windText);
  }

  return lines.join('\n');
}


// ============================================================================
// 更新確認（11時・17時発表の変化検出）
// ============================================================================

/**
 * 気象庁の11時発表・17時発表を受けて、天気予報に大きな変化がないか確認します。
 * 大きな変化があった場合のみ Discord に追加通知します。
 * 時間主導トリガーから自動的に呼び出されます。
 */
function checkUpdate() {
  try {
    console.log('=== 天気予報 更新確認 開始 ===');

    var webhookUrl = getWebhookUrl();
    var data = fetchWeatherJson(CONFIG.AREA_CODE);
    var newInfo = buildWeatherInfo(data);
    var snapshot = loadWeatherSnapshot();

    if (!snapshot) {
      console.log('前回の天気データがありません。スナップショットを保存して終了します。');
      saveWeatherSnapshot(newInfo);
      console.log('=== 天気予報 更新確認 完了 ===');
      return;
    }

    // 発表時刻が前回と同じならスキップ（新しい予報がまだ出ていない）
    if (snapshot.reportDatetime === newInfo.reportDatetime) {
      console.log('発表時刻が前回と同じです（' + formatReportDatetime(newInfo.reportDatetime) + '）。更新なし。');
      console.log('=== 天気予報 更新確認 完了 ===');
      return;
    }

    console.log('新たな発表を検出: ' + formatReportDatetime(newInfo.reportDatetime));

    // 日付が変わっていたら朝の通常投稿に任せる
    var todayDate = getTodayDateJst();
    if (snapshot.date !== todayDate) {
      console.log('日付が変わっています（' + snapshot.date + ' → ' + todayDate + '）。更新確認をスキップします。');
      saveWeatherSnapshot(newInfo);
      console.log('=== 天気予報 更新確認 完了 ===');
      return;
    }

    var changes = detectSignificantChanges(snapshot, newInfo);

    if (changes.length > 0) {
      console.log('大きな変化を検出しました（' + changes.length + '件）: ' + changes.join(', '));
      var message = formatUpdateMessage(newInfo, changes);
      postToDiscord(webhookUrl, message);
      saveWeatherSnapshot(newInfo);
      console.log('更新通知を投稿しました');
    } else {
      console.log('大きな変化はありませんでした。投稿をスキップします。');
    }

    console.log('=== 天気予報 更新確認 完了 ===');
  } catch (e) {
    console.error('【エラー】checkUpdate() で例外が発生しました');
    console.error('  message: ' + e.message);
    console.error('  stack: ' + e.stack);
    // checkUpdate ではエラーを投げず、ログに残すだけにする
    // （朝の通常投稿があるため、更新確認の失敗は致命的ではない）
  }
}


// ============================================================================
// 変化検出ロジック
// ============================================================================

/**
 * 前回の天気スナップショットと新しい天気情報を比較し、
 * 大きな変化があれば変化内容の説明を配列で返します。
 *
 * @param {Object} snapshot - 前回保存したスナップショット
 * @param {Object} newInfo - 新しい天気情報
 * @return {Array<string>} 変化の説明文の配列。変化がない場合は空配列
 */
function detectSignificantChanges(snapshot, newInfo) {
  var changes = [];

  // 1. 天気カテゴリの変化（晴れ・くもり系 → 雨・雪系、またはその逆）
  var oldGroup = getWeatherGroup(snapshot.weatherCode);
  var newGroup = getWeatherGroup(newInfo.weatherCode);
  if (oldGroup !== newGroup) {
    if (newGroup === 'rain' || newGroup === 'snow') {
      changes.push('天気が「' + newInfo.weatherText + '」に変わりました');
    } else if (oldGroup === 'rain' || oldGroup === 'snow') {
      changes.push('天気が「' + newInfo.weatherText + '」に回復しました');
    }
  }

  // 2. 降水確率の最大値がしきい値以上変わった
  var oldMaxPop = snapshot.maxPop || 0;
  var newMaxPop = newInfo.maxPop !== null ? newInfo.maxPop : 0;
  var popDiff = Math.abs(newMaxPop - oldMaxPop);
  if (popDiff >= CONFIG.POP_CHANGE_THRESHOLD) {
    if (newMaxPop > oldMaxPop) {
      changes.push('降水確率が' + popDiff + '%上昇しました（最大' + newMaxPop + '%）');
    } else {
      changes.push('降水確率が' + popDiff + '%低下しました（最大' + newMaxPop + '%）');
    }
  }

  // 3. 雨のピーク時間帯の変化
  var newPeakPeriods = extractPeakPeriods(newInfo.popsToday, newInfo.maxPop);
  if (snapshot.peakPeriods !== newPeakPeriods && newPeakPeriods !== '') {
    changes.push('雨のピーク時間帯が「' + newPeakPeriods + '」に変わりました');
  }

  // 4. 風の強さが強くなった
  var oldWind = snapshot.windLevel || 'normal';
  var newWind = getWindLevel(newInfo.windText || '');
  var windOrder = { 'normal': 0, 'strong': 1, 'veryStrong': 2 };
  if (windOrder[newWind] > windOrder[oldWind]) {
    changes.push('風が強まる予報に変わりました（' + newInfo.windText + '）');
  }

  // 5. 気温がしきい値以上変わった
  if (snapshot.maxTemp !== null && newInfo.maxTemp !== null) {
    if (Math.abs(newInfo.maxTemp - snapshot.maxTemp) >= CONFIG.TEMP_CHANGE_THRESHOLD) {
      var maxDiff = newInfo.maxTemp - snapshot.maxTemp;
      changes.push('最高気温が' + Math.abs(maxDiff) + '℃' + (maxDiff > 0 ? '上がり' : '下がり') + 'ました（' + newInfo.maxTemp + '℃）');
    }
  }
  if (snapshot.minTemp !== null && newInfo.minTemp !== null) {
    if (Math.abs(newInfo.minTemp - snapshot.minTemp) >= CONFIG.TEMP_CHANGE_THRESHOLD) {
      var minDiff = newInfo.minTemp - snapshot.minTemp;
      changes.push('最低気温が' + Math.abs(minDiff) + '℃' + (minDiff > 0 ? '上がり' : '下がり') + 'ました（' + newInfo.minTemp + '℃）');
    }
  }

  // 6. 服装目安の大きな変化（傘・風・気温区分の変化）
  var clothingChanged = detectClothingChange(snapshot, newInfo);
  if (clothingChanged) {
    changes.push(clothingChanged);
  }

  return changes;
}


// ============================================================================
// 変化検出の補助関数
// ============================================================================

/**
 * 天気コードから天気グループを判定します。
 * @param {string|number|null} weatherCode - 気象庁天気コード
 * @return {string} 'fine' | 'cloudy' | 'rain' | 'snow' | 'unknown'
 */
function getWeatherGroup(weatherCode) {
  if (!weatherCode && weatherCode !== 0) return 'unknown';
  var code = String(weatherCode);
  var firstDigit = code.charAt(0);
  if (firstDigit === '1') return 'fine';      // 100番台：晴れ系
  if (firstDigit === '2') return 'cloudy';    // 200番台：くもり系
  if (firstDigit === '3') return 'rain';      // 300番台：雨系
  if (firstDigit === '4') return 'snow';      // 400番台：雪系
  return 'unknown';
}

/**
 * 降水確率データから、最大降水確率と同じ値の時間帯名を連結して返します。
 * 更新通知では雨のピークを簡潔に「午後・夜」のように表示するために使用します。
 *
 * @param {Array} popsToday - [{period, value}, ...]
 * @param {number|null} maxPop - 最大降水確率
 * @return {string} 時間帯名（例: "午後・夜"）。データなしの場合は空文字列
 */
function extractPeakPeriods(popsToday, maxPop) {
  if (!popsToday || popsToday.length === 0 || maxPop === null || maxPop === 0) return '';
  var periods = [];
  for (var i = 0; i < popsToday.length; i++) {
    if (popsToday[i].value === maxPop) {
      periods.push(popsToday[i].period);
    }
  }
  return periods.join('・');
}

/**
 * 服装目安に大きな変化があったかどうかを判定します。
 * 傘推奨の有無、風対策の有無、気温区分の変化をチェックします。
 *
 * @param {Object} snapshot - 前回スナップショット
 * @param {Object} newInfo - 新しい天気情報
 * @return {string} 変化の説明。変化なしの場合は空文字列
 */
function detectClothingChange(snapshot, newInfo) {
  var oldAdvice = snapshot.clothingAdvice || '';
  var newAdvice = newInfo.clothingAdvice || '';

  // 傘関連のアドバイスが新しく追加された
  var oldHasUmbrella = oldAdvice.indexOf('傘') !== -1;
  var newHasUmbrella = newAdvice.indexOf('傘') !== -1;
  if (!oldHasUmbrella && newHasUmbrella) {
    return '雨の可能性が高まったため、傘があると安心です';
  }

  // 風対策が新しく追加された
  var oldHasWind = oldAdvice.indexOf('風を通しにくい') !== -1;
  var newHasWind = newAdvice.indexOf('風を通しにくい') !== -1;
  if (!oldHasWind && newHasWind) {
    return '風が強まるため、風を通しにくい服装がおすすめです';
  }

  // 気温区分が変わった（服装アドバイスの最初の一文が変化）
  var oldTempPart = oldAdvice.split('。')[0];
  var newTempPart = newAdvice.split('。')[0];
  if (oldTempPart !== newTempPart && oldTempPart !== '' && newTempPart !== '') {
    return newTempPart + 'に変わりました';
  }

  return '';
}


// ============================================================================
// 天気スナップショット管理（前回投稿内容との比較用）
// ============================================================================

/**
 * 天気情報のスナップショットをスクリプトプロパティに保存します。
 * 11時・17時の更新確認時に、前回投稿からの変化を検出するために使用します。
 *
 * 保存される内容: 発表時刻、日付、天気コード、天気テキスト、
 *   最大降水確率、雨のピーク時間帯、風レベル、最高/最低気温、服装目安
 *
 * @param {Object} info - buildWeatherInfo() の戻り値
 */
function saveWeatherSnapshot(info) {
  var props = PropertiesService.getScriptProperties();

  var snapshot = {
    reportDatetime: info.reportDatetime || '',
    date: getTodayDateJst(),
    weatherCode: info.weatherCode || '',
    weatherText: info.weatherText || '',
    maxPop: info.maxPop !== null ? info.maxPop : 0,
    peakPeriods: extractPeakPeriods(info.popsToday, info.maxPop),
    windLevel: getWindLevel(info.windText || ''),
    maxTemp: info.maxTemp,
    minTemp: info.minTemp,
    clothingAdvice: info.clothingAdvice || ''
  };

  props.setProperty('WEATHER_SNAPSHOT', JSON.stringify(snapshot));
  console.log('天気スナップショットを保存しました（' + formatReportDatetime(info.reportDatetime) + '）');
}

/**
 * 前回保存した天気スナップショットをスクリプトプロパティから読み込みます。
 * @return {Object|null} スナップショットオブジェクト。未保存の場合は null
 */
function loadWeatherSnapshot() {
  var props = PropertiesService.getScriptProperties();
  var json = props.getProperty('WEATHER_SNAPSHOT');

  if (!json || json === '') {
    console.log('天気スナップショットはまだ保存されていません');
    return null;
  }

  try {
    var snapshot = JSON.parse(json);
    console.log('天気スナップショットを読み込みました（日付: ' + (snapshot.date || '不明') + '）');
    return snapshot;
  } catch (e) {
    console.warn('天気スナップショットのパースに失敗しました: ' + e.message);
    return null;
  }
}


// ============================================================================
// 更新確認のテスト用
// ============================================================================

/**
 * 更新確認の動作をテストします。
 *
 * 実際に気象庁 JSON を取得し、前回保存したスナップショットと比較します。
 * 検出された変化の内容をログに出力し、更新通知文のプレビューを表示します。
 * この関数では実際の Discord 投稿は行いません。
 *
 * 使い方:
 *   1. まず testPost() を実行してスナップショットを保存
 *   2. しばらく時間をおいて（または気象庁の新しい発表が出たあとに）
 *      testUpdateCheck() を実行すると変化の有無を確認できます
 *
 * GAS エディタでこの関数を選択して「実行」してください。
 */
function testUpdateCheck() {
  console.log('=== 更新確認テスト 開始 ===');

  try {
    getWebhookUrl(); // URLが設定されているか確認のみ（投稿はしない）
    var data = fetchWeatherJson(CONFIG.AREA_CODE);
    var newInfo = buildWeatherInfo(data);
    var snapshot = loadWeatherSnapshot();

    console.log('');
    console.log('--- 現在の天気情報 ---');
    console.log('  発表時刻: ' + formatReportDatetime(newInfo.reportDatetime));
    console.log('  天気: ' + newInfo.weatherText + ' (コード: ' + (newInfo.weatherCode || 'なし') + ')');
    console.log('  降水確率最大: ' + (newInfo.maxPop !== null ? newInfo.maxPop + '%' : 'なし'));
    if (newInfo.popsToday && newInfo.popsToday.length > 0) {
      var popLogParts = [];
      for (var i = 0; i < newInfo.popsToday.length; i++) {
        popLogParts.push(newInfo.popsToday[i].period + ' ' + newInfo.popsToday[i].value + '%');
      }
      console.log('  降水確率詳細: ' + popLogParts.join(' / '));
    }
    console.log('  最高気温: ' + (newInfo.maxTemp !== null ? newInfo.maxTemp + '℃' : 'なし'));
    console.log('  最低気温: ' + (newInfo.minTemp !== null ? newInfo.minTemp + '℃' : 'なし'));
    console.log('  風: ' + (newInfo.windText || 'なし') + ' (レベル: ' + getWindLevel(newInfo.windText || '') + ')');
    console.log('  服装目安: ' + (newInfo.clothingAdvice || 'なし'));

    if (!snapshot) {
      console.log('');
      console.log('前回のスナップショットがありません。');
      console.log('現在の天気情報をスナップショットとして保存します。');
      saveWeatherSnapshot(newInfo);
      console.log('');
      console.log('もう一度 testUpdateCheck() を実行すると比較できます。');
      console.log('（実際の運用では、testPost() を実行した時点でスナップショットが保存されます）');
    } else {
      console.log('');
      console.log('--- 前回スナップショット ---');
      console.log('  発表時刻: ' + formatReportDatetime(snapshot.reportDatetime));
      console.log('  日付: ' + (snapshot.date || '不明'));
      console.log('  天気: ' + (snapshot.weatherText || '不明') + ' (コード: ' + (snapshot.weatherCode || 'なし') + ')');
      console.log('  天気グループ: ' + getWeatherGroup(snapshot.weatherCode));
      console.log('  降水確率最大: ' + (snapshot.maxPop || 0) + '%');
      console.log('  ピーク時間帯: ' + (snapshot.peakPeriods || 'なし'));
      console.log('  最高気温: ' + (snapshot.maxTemp !== null ? snapshot.maxTemp + '℃' : 'なし'));
      console.log('  最低気温: ' + (snapshot.minTemp !== null ? snapshot.minTemp + '℃' : 'なし'));
      console.log('  風レベル: ' + (snapshot.windLevel || 'normal'));

      console.log('');
      console.log('--- 変化検出 ---');
      var changes = detectSignificantChanges(snapshot, newInfo);
      if (changes.length > 0) {
        console.log('以下の大きな変化を検出しました:');
        for (var j = 0; j < changes.length; j++) {
          console.log('  ' + (j + 1) + '. ' + changes[j]);
        }
        console.log('');
        console.log('※ このテストでは実際の Discord 投稿は行っていません。');
        console.log('※ 本番では以下の更新通知が投稿されます:');
        console.log('--- 投稿プレビュー ---');
        console.log(formatUpdateMessage(newInfo, changes));
        console.log('--- プレビューここまで ---');
      } else {
        console.log('大きな変化は検出されませんでした。更新通知は不要です。');
      }
    }
  } catch (e) {
    console.error('【エラー】testUpdateCheck() で例外が発生しました');
    console.error('  message: ' + e.message);
    console.error('  stack: ' + e.stack);
  }

  console.log('');
  console.log('=== 更新確認テスト 終了 ===');
}


// ============================================================================
// Discord 投稿
// ============================================================================

/**
 * Discord の Webhook URL にメッセージを投稿します。
 *
 * Embed は使わず、content にテキストを入れるだけのシンプルな投稿です。
 *
 * @param {string} webhookUrl - Discord Webhook URL
 * @param {string} message - 投稿するメッセージ本文
 */
function postToDiscord(webhookUrl, message) {
  console.log('Discord に投稿中...');

  var payload = {
    content: message
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(webhookUrl, options);
  var statusCode = response.getResponseCode();

  if (statusCode === 204) {
    // Discord Webhook の成功レスポンスは 204 No Content
    console.log('Discord 投稿成功 (HTTP 204)');
  } else if (statusCode >= 200 && statusCode < 300) {
    console.log('Discord 投稿成功 (HTTP ' + statusCode + ')');
  } else {
    var body = response.getContentText();
    throw new Error(
      'Discord 投稿に失敗しました。\n' +
      '  ステータスコード: ' + statusCode + '\n' +
      '  レスポンス: ' + body.slice(0, 500)
    );
  }
}


// ============================================================================
// 拡張用スタブ関数（将来、別のデータソースで補う場合のためのプレースホルダ）
// ============================================================================

/**
 * 【未実装】湿度情報を取得します。
 *
 * 気象庁の無料 JSON（エリア予報）だけでは湿度データが提供されていません。
 * そのため現在は null を返します。
 * 将来的に別の無料データソースが見つかった場合に実装してください。
 *
 * @return {null}
 */
function getHumidityInfo() {
  // TODO: 湿度データを提供する無料APIがあれば実装
  return null;
}

/**
 * 【未実装】UV インデックス情報を取得します。
 *
 * 気象庁の無料 JSON（エリア予報）だけでは UV インデックスが提供されていません。
 * そのため現在は null を返します。
 * 将来的に別の無料データソースが見つかった場合に実装してください。
 *
 * @return {null}
 */
function getUvInfo() {
  // TODO: UVインデックスデータを提供する無料APIがあれば実装
  return null;
}
