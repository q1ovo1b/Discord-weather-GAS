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

    // 3. 天気情報を抽出（気温のフォールバックは buildWeatherInfo 内で自動処理）
    var weatherInfo = buildWeatherInfo(data);

    // 4. Discord 投稿文を作成
    var message = formatDiscordMessage(weatherInfo);

    // 5. Discord に投稿
    postToDiscord(webhookUrl, message);

    // 6. スナップショットを保存（11時・17時の更新確認用）
    //    buildWeatherInfo 内で気温スナップショットも自動保存される
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
  console.log('');
  console.log('テスト投稿の結果はDiscordチャンネルで確認してください。');
  console.log('気温データの取得状況は上のログで確認できます。');
  console.log('気温が表示されない場合は debugTemperature() を実行してJSON構造を確認してください。');
  console.log('=== テスト投稿 終了 ===');
}


// ============================================================================
// 気温スナップショットの確認用
// ============================================================================

/**
 * 今日の日付の気温スナップショットが Script Properties に保存されているか確認します。
 *
 * 夕方の投稿で気温が表示されない場合、この関数でスナップショットの有無を
 * 確認してください。スナップショットは朝6時台や11時台の buildWeatherInfo
 * で自動保存されます。
 *
 * Discord への投稿は行いません。
 * GAS エディタでこの関数を選択して「実行」してください。
 */
function debugTemperatureSnapshot() {
  console.log('=== 気温スナップショット 確認 ===');
  console.log('');

  var todayDate = getTodayDateJst();
  var key = 'WEATHER_TEMP_SNAPSHOT_' + todayDate;

  console.log('【検索情報】');
  console.log('  今日の日付 (JST): ' + todayDate);
  console.log('  検索キー          : ' + key);
  console.log('  保存先            : Script Properties');
  console.log('');

  var props = PropertiesService.getScriptProperties();
  var allKeys = props.getKeys();
  var tempSnapshotKeys = [];
  for (var i = 0; i < allKeys.length; i++) {
    if (allKeys[i].indexOf('WEATHER_TEMP_SNAPSHOT_') === 0) {
      tempSnapshotKeys.push(allKeys[i]);
    }
  }

  console.log('【Script Properties 内の気温スナップショット一覧】');
  if (tempSnapshotKeys.length === 0) {
    console.log('  気温スナップショットは1件も保存されていません。');
  } else {
    for (var j = 0; j < tempSnapshotKeys.length; j++) {
      var raw = props.getProperty(tempSnapshotKeys[j]);
      var marker = (tempSnapshotKeys[j] === key) ? ' ★今日の日付' : '';
      if (raw) {
        try {
          var parsed = JSON.parse(raw);
          console.log(
            '  ' + tempSnapshotKeys[j] + marker + '\n' +
            '    日付: ' + (parsed.date || '不明') +
            '  最高: ' + (parsed.maxTemp !== null ? parsed.maxTemp + '℃' : 'null') +
            '  最低: ' + (parsed.minTemp !== null ? parsed.minTemp + '℃' : 'null') +
            '  保存時刻: ' + (parsed.savedAt || '不明')
          );
        } catch (e) {
          console.log('  ' + tempSnapshotKeys[j] + '（パースエラー: ' + e.message + '）');
        }
      } else {
        console.log('  ' + tempSnapshotKeys[j] + '（値が空）');
      }
    }
  }

  console.log('');
  console.log('【判定】');
  var json = props.getProperty(key);
  if (!json || json === '') {
    console.log('  今日の気温スナップショットは保存されていません。');
    console.log('');
    console.log('  保存されるタイミング:');
    console.log('    - testPost() または main() の実行時（朝6時台の通常投稿）');
    console.log('    - checkUpdate() の実行時（11時台・17時台の更新確認）');
    console.log('    → buildWeatherInfo() 内で今日の気温がJSONから取得できた場合に自動保存されます');
    console.log('');
    console.log('  考えられる原因:');
    console.log('    - まだ一度も testPost() を実行していない');
    console.log('    - 前回実行時も JSON に今日の気温がなかった（17時発表のJSONなど）');
    console.log('    - TEMP_STATION_CODE が誤っている');
    console.log('');
    console.log('  対処:');
    console.log('    - 朝6時台または11時台に testPost() を実行する');
    console.log('    - または testSaveTemperatureSnapshot() を実行する');
  } else {
    try {
      var data = JSON.parse(json);
      console.log('  今日の気温スナップショットが存在します。');
      console.log('    日付     : ' + (data.date || '不明'));
      console.log('    最高気温 : ' + (data.maxTemp !== null ? data.maxTemp + '℃' : 'null'));
      console.log('    最低気温 : ' + (data.minTemp !== null ? data.minTemp + '℃' : 'null'));
      console.log('    保存時刻 : ' + (data.savedAt || '不明'));
      console.log('');
      console.log('  → 今日の気温スナップショットは正常に保存されています。');
      console.log('  → 17時発表などでJSONに今日の気温がない場合、この値が補完に使われます。');
    } catch (e) {
      console.log('  今日の気温スナップショットのパースに失敗しました: ' + e.message);
    }
  }

  console.log('');
  console.log('=== 気温スナップショット 確認 終了 ===');
}


// ============================================================================
// 気温スナップショットの手動保存用
// ============================================================================

/**
 * 現在の気象庁JSONから今日の気温を取得し、気温スナップショットを保存します。
 *
 * 明日の気温を今日の気温として保存することはありません。
 * JSONに今日の日付の気温データが含まれている場合のみ保存します。
 *
 * 使い方:
 *   夕方の投稿で気温が表示されない場合、この関数を実行して
 *   気温スナップショットを作成した後、再度 testPost() を実行してください。
 *   （通常は朝6時台の testPost() で自動保存されるため、手動実行は不要です）
 *
 * Discord への投稿は行いません。
 * GAS エディタでこの関数を選択して「実行」してください。
 */
function testSaveTemperatureSnapshot() {
  console.log('=== 気温スナップショット 手動保存 ===');
  console.log('');

  var todayDate = getTodayDateJst();
  var key = 'WEATHER_TEMP_SNAPSHOT_' + todayDate;

  console.log('今日の日付: ' + todayDate);
  console.log('保存キー  : ' + key);
  console.log('');

  // JSON から今日の気温を抽出
  var data;
  try {
    data = fetchWeatherJson(CONFIG.AREA_CODE);
  } catch (e) {
    console.error('気象庁 JSON の取得に失敗: ' + e.message);
    console.log('');
    console.log('=== 気温スナップショット 手動保存 終了 ===');
    return;
  }

  var shortForecast = data[0];
  if (!shortForecast || !Array.isArray(shortForecast.timeSeries)) {
    console.error('JSONの構造が想定と異なります。');
    console.log('');
    console.log('=== 気温スナップショット 手動保存 終了 ===');
    return;
  }

  var timeSeries = shortForecast.timeSeries;

  // timeSeries から気温データを動的検索
  var temps = extractTemperaturesFromSeries(timeSeries);

  console.log('【抽出結果】');
  console.log('  maxTemp: ' + (temps.maxTemp !== null ? temps.maxTemp + '℃' : 'null'));
  console.log('  minTemp: ' + (temps.minTemp !== null ? temps.minTemp + '℃' : 'null'));
  console.log('');

  // 今日の気温が1つも取れない場合は保存しない
  if (temps.maxTemp === null && temps.minTemp === null) {
    console.log('【判定】');
    console.log('  今日の日付（' + todayDate + '）の気温データがJSONに含まれていません。');
    console.log('  これは17時発表のJSONでは正常な動作です。');
    console.log('');

    // 今日以外にどんな日付のデータがあるか確認
    console.log('【参考】JSON に含まれる日付:');
    // extractTemperaturesFromSeries のログで表示済みなので、ここでは簡潔に
    console.log('  上のログを確認してください。timeSeries 内の timeDefines から日付を確認できます。');
    console.log('');

    console.log('気温スナップショットは保存されませんでした。');
    console.log('（明日の気温を今日の気温として保存することはありません）');
    console.log('');
    console.log('対処: 朝6時台または11時台に testPost() を実行すると、');
    console.log('      JSONに今日の気温があれば自動でスナップショットが保存されます。');
  } else {
    console.log('【判定】');
    console.log('  今日の気温データがJSONに含まれています。スナップショットを保存します。');
    console.log('');

    saveTempSnapshot(temps.maxTemp, temps.minTemp);

    console.log('');
    console.log('保存が完了しました。');
    console.log('この後 testPost() を実行すると、気温行が表示されるはずです。');
  }

  console.log('');
  console.log('=== 気温スナップショット 手動保存 終了 ===');
}


// ============================================================================
// デバッグ：気温データ取得状況の詳細確認
// ============================================================================

/**
 * 気温データの取得状況を詳細にログ出力します。
 *
 * 気象庁 JSON の全 timeSeries の構造、TEMP_STATION_CODE に一致する
 * area の有無、今日の日付のデータの有無、抽出結果をまとめて表示します。
 * Discord への投稿は行いません。
 *
 * 気温が投稿文に表示されない場合の原因調査に使ってください。
 *
 * GAS エディタでこの関数を選択して「実行」してください。
 */
function debugTemperature() {
  console.log('=== 気温データ取得状況 デバッグ ===');
  console.log('');

  // ---- 設定値 ----
  console.log('【設定】');
  console.log('  AREA_CODE        : ' + CONFIG.AREA_CODE);
  console.log('  TEMP_STATION_CODE: ' + CONFIG.TEMP_STATION_CODE);
  console.log('  今日の日付 (JST) : ' + getTodayDateJst());
  console.log('');

  // ---- JSON 取得 ----
  var data;
  try {
    data = fetchWeatherJson(CONFIG.AREA_CODE);
  } catch (e) {
    console.error('気象庁 JSON の取得に失敗: ' + e.message);
    console.log('=== デバッグ 終了 ===');
    return;
  }

  var shortForecast = data[0];
  var weeklyForecast = data[1] || null;

  if (!shortForecast || !Array.isArray(shortForecast.timeSeries)) {
    console.error('短期予報の timeSeries が取得できませんでした。');
    console.log('=== デバッグ 終了 ===');
    return;
  }

  var timeSeries = shortForecast.timeSeries;

  console.log('【発表情報】');
  console.log('  発表時刻  : ' + (shortForecast.reportDatetime || '不明'));
  console.log('  発表官署  : ' + (shortForecast.publishingOffice || '不明'));
  console.log('  timeSeries数: ' + timeSeries.length);
  console.log('');

  // ---- 各 timeSeries の詳細 ----
  console.log('【各 timeSeries の詳細】');
  var todayDate = getTodayDateJst();

  for (var si = 0; si < timeSeries.length; si++) {
    var ts = timeSeries[si];
    console.log('--- timeSeries[' + si + '] ---');

    // timeDefines
    var tdList = (ts.timeDefines && Array.isArray(ts.timeDefines)) ? ts.timeDefines : [];
    console.log('  timeDefines (' + tdList.length + '件):');
    for (var tdi = 0; tdi < tdList.length; tdi++) {
      var d = extractDateFromIso(tdList[tdi]);
      var marker = (d === todayDate) ? ' ★今日' : '';
      console.log('    [' + tdi + '] ' + tdList[tdi] + ' → ' + d + marker);
    }

    // areas
    if (!ts.areas || !Array.isArray(ts.areas)) {
      console.log('  areas: なし');
      continue;
    }

    console.log('  areas (' + ts.areas.length + '件):');
    for (var ai = 0; ai < ts.areas.length; ai++) {
      var a = ts.areas[ai];
      if (!a || !a.area) continue;

      var fields = [];
      if (a.weatherCodes) fields.push('weatherCodes[' + a.weatherCodes.length + ']');
      if (a.weathers) fields.push('weathers[' + a.weathers.length + ']');
      if (a.winds) fields.push('winds[' + a.winds.length + ']');
      if (a.pops) fields.push('pops[' + a.pops.length + ']');
      if (a.temps) fields.push('temps[' + a.temps.length + ']');

      var isTarget = (a.area.code === CONFIG.TEMP_STATION_CODE);
      var prefix = isTarget ? '  ▶' : '   ';
      console.log(prefix + ' code=' + a.area.code + ' name=' + a.area.name + ' fields=(' + fields.join(', ') + ')');

      // TEMP_STATION_CODE に一致する area のデータを詳細表示
      if (isTarget && a.temps) {
        console.log('    ★★★ TEMP_STATION_CODE 発見 ★★★');
        console.log('    temps 生データ: [' + a.temps.join(', ') + ']');
        console.log('    timeDefines との対応:');
        for (var ti = 0; ti < tdList.length && ti < a.temps.length; ti++) {
          var dd = extractDateFromIso(tdList[ti]);
          var mm = (dd === todayDate) ? ' ★今日のデータ' : '';
          console.log('      [' + ti + '] ' + tdList[ti] + ' → ' + a.temps[ti] + '℃' + mm);
        }
      }
    }
  }

  // ---- extractTemperaturesFromSeries で抽出 ----
  console.log('');
  console.log('【extractTemperaturesFromSeries の実行結果】');
  var result = extractTemperaturesFromSeries(timeSeries);
  console.log('  maxTemp: ' + (result.maxTemp !== null ? result.maxTemp + '℃' : 'null'));
  console.log('  minTemp: ' + (result.minTemp !== null ? result.minTemp + '℃' : 'null'));

  // ---- 週間予報の確認 ----
  if (weeklyForecast && weeklyForecast.timeSeries) {
    console.log('');
    console.log('【週間予報の気温データ（フォールバック候補）】');
    var weeklyResult = extractTempsFromWeekly(weeklyForecast.timeSeries);
    console.log('  maxTemp: ' + (weeklyResult.maxTemp !== null ? weeklyResult.maxTemp + '℃' : 'null'));
    console.log('  minTemp: ' + (weeklyResult.minTemp !== null ? weeklyResult.minTemp + '℃' : 'null'));
  }

  // ---- 気温スナップショットの確認 ----
  console.log('');
  console.log('【気温スナップショット（日付キー: WEATHER_TEMP_SNAPSHOT_' + getTodayDateJst() + '）】');
  var tempSnapshot = loadTempSnapshot();
  if (tempSnapshot) {
    console.log('  日付    : ' + (tempSnapshot.date || '不明'));
    console.log('  maxTemp : ' + (tempSnapshot.maxTemp !== null ? tempSnapshot.maxTemp + '℃' : 'null'));
    console.log('  minTemp : ' + (tempSnapshot.minTemp !== null ? tempSnapshot.minTemp + '℃' : 'null'));
    console.log('  保存時刻: ' + (tempSnapshot.savedAt || '不明'));
    console.log('  → フォールバックとして使用可能です。');
  } else {
    console.log('  今日の気温スナップショットはまだ保存されていません。');
  }

  // ---- 参考: 天気スナップショットの気温（念のため） ----
  console.log('');
  console.log('【参考: 天気スナップショット内の気温】');
  var weatherSnap = loadWeatherSnapshot();
  if (weatherSnap) {
    console.log('  日付    : ' + (weatherSnap.date || '不明'));
    console.log('  maxTemp : ' + (weatherSnap.maxTemp !== null ? weatherSnap.maxTemp + '℃' : 'null'));
    console.log('  minTemp : ' + (weatherSnap.minTemp !== null ? weatherSnap.minTemp + '℃' : 'null'));
  } else {
    console.log('  天気スナップショットはまだ保存されていません。');
  }

  // ---- 総合判定（buildWeatherInfo と同じロジックを再現） ----
  console.log('');
  console.log('【総合判定（buildWeatherInfo と同じロジック）】');

  // A. JSONから取得
  var finalMax = result.maxTemp;
  var finalMin = result.minTemp;

  // B. 週間予報から補完
  if (weeklyForecast && weeklyForecast.timeSeries && (finalMax === null || finalMin === null)) {
    var wkt = extractTempsFromWeekly(weeklyForecast.timeSeries);
    if (finalMax === null) finalMax = wkt.maxTemp;
    if (finalMin === null) finalMin = wkt.minTemp;
  }

  // C. 気温スナップショットから補完
  if ((finalMax === null || finalMin === null) && tempSnapshot) {
    if (finalMax === null && tempSnapshot.maxTemp !== null) finalMax = tempSnapshot.maxTemp;
    if (finalMin === null && tempSnapshot.minTemp !== null) finalMin = tempSnapshot.minTemp;
  }

  console.log('  最終 maxTemp: ' + (finalMax !== null ? finalMax + '℃' : 'null'));
  console.log('  最終 minTemp: ' + (finalMin !== null ? finalMin + '℃' : 'null'));

  if (finalMax !== null && finalMin !== null) {
    console.log('');
    console.log('  表示例: 気温：最高 ' + finalMax + '℃ / 最低 ' + finalMin + '℃');
  } else if (finalMax !== null) {
    console.log('');
    console.log('  表示例: 気温：最高 ' + finalMax + '℃');
  } else if (finalMin !== null) {
    console.log('');
    console.log('  表示例: 気温：最低 ' + finalMin + '℃');
  } else {
    console.log('');
    console.log('  → 気温データが取得できません。投稿文に気温行は表示されません。');
    console.log('  → 考えられる原因:');
    console.log('    1. TEMP_STATION_CODE (' + CONFIG.TEMP_STATION_CODE + ') が誤っている');
    console.log('    2. 気象庁JSONの構造が変更された');
    console.log('    3. 今日の気温データが JSON になく、気温スナップショットも未保存');
    console.log('  → 対処:');
    console.log('    a. area.json で正しい class20s コードを確認する');
    console.log('    b. 朝6時台または11時台に testPost を実行し気温スナップショットを保存する');
    console.log('    c. その後、再度 testPost または debugTemperature を実行する');
  }

  console.log('');
  console.log('=== 気温データ取得状況 デバッグ 終了 ===');
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
 * 気温データの取得優先順位:
 *   A. 気象庁JSON から今日の日付の最高・最低気温を取得できた場合 → その値を使う
 *   B. JSONに今日の気温がない場合 → 同じ日付の気温スナップショットから補完
 *      （朝6時台や11時台に取得して Script Properties に保存された値）
 *   C. どちらにもない場合 → 気温行を省略（null）
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

  // --- 気温（timeSeries から temps を持つ系列を動的に検索）---
  // timeSeries[2] 固定ではなく、全 timeSeries の中から
  // TEMP_STATION_CODE に一致する area が temps を持つ系列を探します。
  // 気象庁 JSON の timeSeries 構成は発表時刻によって変わることがあるため、
  // インデックス固定にせず動的検索します。
  var jsonTemps = extractTemperaturesFromSeries(timeSeries);
  var temps = {
    maxTemp: jsonTemps.maxTemp,
    minTemp: jsonTemps.minTemp
  };
  var tempSourceMax = 'none'; // 'json' | 'weekly' | 'snapshot' | 'none'
  var tempSourceMin = 'none';
  if (temps.maxTemp !== null) tempSourceMax = 'json';
  if (temps.minTemp !== null) tempSourceMin = 'json';

  console.log(
    '気温取得 優先順位A（JSON）: maxTemp=' + (temps.maxTemp !== null ? temps.maxTemp + '℃' : 'null') +
    ', minTemp=' + (temps.minTemp !== null ? temps.minTemp + '℃' : 'null')
  );

  // --- 週間予報から補足（短期予報で不足する場合のフォールバック）---
  if (weeklyForecast && weeklyForecast.timeSeries) {
    if (temps.maxTemp === null || temps.minTemp === null) {
      var weeklyTemps = extractTempsFromWeekly(weeklyForecast.timeSeries);
      if (temps.maxTemp === null && weeklyTemps.maxTemp !== null) {
        temps.maxTemp = weeklyTemps.maxTemp;
        tempSourceMax = 'weekly';
      }
      if (temps.minTemp === null && weeklyTemps.minTemp !== null) {
        temps.minTemp = weeklyTemps.minTemp;
        tempSourceMin = 'weekly';
      }
    }
  }

  console.log(
    '気温取得 優先順位B（週間予報）: maxTemp=' + (temps.maxTemp !== null ? temps.maxTemp + '℃' : 'null') +
    ', minTemp=' + (temps.minTemp !== null ? temps.minTemp + '℃' : 'null')
  );

  // --- 気温スナップショットから補完（夕方の17時発表では今日の気温データが含まれないため）---
  // 17時発表の JSON では timeSeries から今日の日付が除外されることがあります。
  // その場合、同日中の別の発表（6時台や11時台）で取得・保存した気温データで補完します。
  // 翌日の気温は今日の投稿には使いません（日付が一致するものだけ使用）。
  if (temps.maxTemp === null || temps.minTemp === null) {
    var savedTemps = loadTempSnapshot();
    if (savedTemps) {
      if (temps.maxTemp === null && savedTemps.maxTemp !== null) {
        temps.maxTemp = savedTemps.maxTemp;
        tempSourceMax = 'snapshot';
        console.log('  → スナップショットから最高気温を補完: ' + savedTemps.maxTemp + '℃');
      }
      if (temps.minTemp === null && savedTemps.minTemp !== null) {
        temps.minTemp = savedTemps.minTemp;
        tempSourceMin = 'snapshot';
        console.log('  → スナップショットから最低気温を補完: ' + savedTemps.minTemp + '℃');
      }
    } else {
      console.log('  → 今日の気温スナップショットがなく、補完できませんでした');
    }
  }

  console.log(
    '気温取得 優先順位C（スナップショット）: maxTemp=' + (temps.maxTemp !== null ? temps.maxTemp + '℃' : 'null') +
    ', minTemp=' + (temps.minTemp !== null ? temps.minTemp + '℃' : 'null')
  );

  // 今日の気温が取得できた場合、後の発表のためにスナップショットを保存
  if (temps.maxTemp !== null || temps.minTemp !== null) {
    saveTempSnapshot(temps.maxTemp, temps.minTemp);
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

  // --- 気温取得の最終サマリー ---
  console.log('');
  console.log('===== 気温取得サマリー =====');
  console.log('  発表時刻: ' + formatReportDatetime(shortForecast.reportDatetime || '不明'));
  console.log('  最高気温: ' + (temps.maxTemp !== null ? temps.maxTemp + '℃' : 'null') +
    '（取得元: ' + tempSourceMax + '）');
  console.log('  最低気温: ' + (temps.minTemp !== null ? temps.minTemp + '℃' : 'null') +
    '（取得元: ' + tempSourceMin + '）');
  if (temps.maxTemp === null && temps.minTemp === null) {
    console.log('  → 投稿文の気温行は省略されます（理由: JSON・週間予報・スナップショットのいずれからも取得不可）');
  }
  console.log('===========================');
  console.log('');

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
 * 全 timeSeries の中から、temps データを持つ系列を探して気温を抽出します。
 * インデックス固定ではなく、TEMP_STATION_CODE に一致する area と
 * temps フィールドの両方を持つ系列を動的に検索します。
 *
 * 気象庁 JSON の timeSeries 構成は発表時刻によって異なることがあり、
 * timeSeries[2] に気温が入っているとは限らないため、この関数で吸収します。
 *
 * @param {Array} timeSeries - shortForecast.timeSeries
 * @return {Object} {maxTemp: number|null, minTemp: number|null, seriesIndex: number}
 */
function extractTemperaturesFromSeries(timeSeries) {
  console.log(
    'timeSeries の構成（全 ' + timeSeries.length + ' 件）:'
  );

  // 各 timeSeries の内容をログに出力
  for (var si = 0; si < timeSeries.length; si++) {
    var ts = timeSeries[si];
    var areaCodes = [];
    if (ts.areas && Array.isArray(ts.areas)) {
      for (var ai = 0; ai < ts.areas.length; ai++) {
        var a = ts.areas[ai];
        if (a && a.area) {
          var hasTemps = (a.temps && Array.isArray(a.temps));
          var hasPops = (a.pops && Array.isArray(a.pops));
          var hasWeatherCodes = (a.weatherCodes && Array.isArray(a.weatherCodes));
          var fields = [];
          if (hasTemps) fields.push('temps');
          if (hasPops) fields.push('pops');
          if (hasWeatherCodes) fields.push('weatherCodes');
          areaCodes.push(a.area.code + '(' + a.area.name + ')[' + fields.join(',') + ']');
        }
      }
    }
    var tdCount = (ts.timeDefines && Array.isArray(ts.timeDefines)) ? ts.timeDefines.length : 0;
    console.log('  timeSeries[' + si + ']: timeDefines数=' + tdCount + ', areas=' + areaCodes.join(' '));
  }

  // TEMP_STATION_CODE に一致し temps を持つ系列を探す
  for (var si2 = 0; si2 < timeSeries.length; si2++) {
    var ts2 = timeSeries[si2];
    if (!ts2.areas || !Array.isArray(ts2.areas)) continue;

    for (var ai2 = 0; ai2 < ts2.areas.length; ai2++) {
      var a2 = ts2.areas[ai2];
      if (a2 && a2.area && a2.area.code === CONFIG.TEMP_STATION_CODE && a2.temps) {
        console.log('気温データを timeSeries[' + si2 + '] から抽出します（地点: ' + a2.area.name + '）');
        return extractTemperatures(ts2);
      }
    }
  }

  // 見つからなかった場合、timeSeries[2] をフォールバックとして試行（後方互換）
  if (timeSeries.length >= 3) {
    console.warn(
      'TEMP_STATION_CODE (' + CONFIG.TEMP_STATION_CODE + ') に一致する temps エリアが' +
      'どの timeSeries にも見つかりませんでした。timeSeries[2] をフォールバックとして試行します。'
    );
    return extractTemperatures(timeSeries[2]);
  }

  console.warn('気温データを含む timeSeries が見つかりませんでした。');
  return { maxTemp: null, minTemp: null };
}


/**
 * 指定された timeSeries エントリから今日の最高・最低気温を抽出します。
 *
 * 構造:
 *   timeDefines: [今日09:00, 今日00:00, 明日00:00, 明日09:00] など
 *   areas: [{ area: {name, code}, temps: [...] }]
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
 * @param {Object} ts - 気温データを含む timeSeries エントリ
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

  // ---- timeSeries[2] の全 timeDefines と温度をログ出力 ----
  console.log(
    '気温 timeSeries[2] の内容（観測地点: ' + CONFIG.TEMP_STATION_CODE + ', 検索日付: ' + todayDate + '）:'
  );
  for (var di = 0; di < timeDefines.length; di++) {
    var d = extractDateFromIso(timeDefines[di]);
    var v = (di < temps.length) ? temps[di] : '（添字範囲外）';
    console.log('  [' + di + '] ' + timeDefines[di] + ' → 日付=' + d + ' 値=' + v);
  }

  var maxTemp = null;
  var minTemp = null;
  var todayMaxCandidates = [];
  var todayMinCandidates = [];

  // 今日の日付のデータを収集
  // 時刻ベースの判定:
  //   T09: を含む → 最高気温候補
  //   それ以外     → 最低気温候補
  // 現在時刻（朝/昼/夕方）では判定しない——今日の日付であれば必ず使用する
  for (var i = 0; i < temps.length && i < timeDefines.length; i++) {
    var tempValue = parseFloat(temps[i]);
    if (isNaN(tempValue)) continue;

    var timeStr = timeDefines[i];
    var dateStr = extractDateFromIso(timeStr);

    if (dateStr === todayDate) {
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

  // ---- 気温取得結果のログ ----
  console.log(
    '気温抽出結果:' +
    ' 最高候補=' + (todayMaxCandidates.length > 0 ? todayMaxCandidates.join(',') : 'なし') +
    ' → maxTemp=' + (maxTemp !== null ? maxTemp + '℃' : 'null') +
    ', 最低候補=' + (todayMinCandidates.length > 0 ? todayMinCandidates.join(',') : 'なし') +
    ' → minTemp=' + (minTemp !== null ? minTemp + '℃' : 'null')
  );

  // 今日の日付のデータが1つもない場合の警告
  // （夕方の17時発表では timeSeries[2] が明日以降の日付のみになることがある）
  if (todayMaxCandidates.length === 0 && todayMinCandidates.length === 0) {
    console.warn(
      '今日（' + todayDate + '）の気温データが timeSeries[2] に見つかりませんでした。' +
      '（17時発表のJSONでは今日の日付が含まれないことがあります）'
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
  //   最高・最低の両方が取得できた場合は「最高 X℃ / 最低 Y℃」。
  //   値が同じでも省略せず、そのまま表示します（例: 最高 25℃ / 最低 25℃）。
  //   片方しか取得できなかった場合は、取得できた方だけ表示します。
  //   どちらも取得できなかった場合のみ、行ごと省略します。
  console.log('');
  console.log('--- 投稿文 気温行の決定 ---');
  console.log('  maxTemp=' + (info.maxTemp !== null ? info.maxTemp + '℃' : 'null') +
    ', minTemp=' + (info.minTemp !== null ? info.minTemp + '℃' : 'null'));
  if (info.maxTemp !== null && info.minTemp !== null) {
    lines.push('気温：最高 ' + info.maxTemp + '℃ / 最低 ' + info.minTemp + '℃');
    console.log('  → 表示: 最高 ' + info.maxTemp + '℃ / 最低 ' + info.minTemp + '℃');
  } else if (info.maxTemp !== null) {
    lines.push('気温：最高 ' + info.maxTemp + '℃');
    console.log('  → 表示: 最高 ' + info.maxTemp + '℃（最低気温が取得できなかったため）');
  } else if (info.minTemp !== null) {
    lines.push('気温：最低 ' + info.minTemp + '℃');
    console.log('  → 表示: 最低 ' + info.minTemp + '℃（最高気温が取得できなかったため）');
  } else {
    console.log('  → 気温行を省略しました（理由: JSON・週間予報・スナップショットのいずれからも気温を取得できなかったため）');
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
  //   最高・最低の両方が取得できた場合は「最高 X℃ / 最低 Y℃」。
  //   値が同じでも省略せず、そのまま表示します。
  //   片方しか取得できなかった場合は、取得できた方だけ表示します。
  //   どちらも取得できなかった場合のみ、行ごと省略します。
  console.log('');
  console.log('--- 更新通知 気温行の決定 ---');
  console.log('  maxTemp=' + (info.maxTemp !== null ? info.maxTemp + '℃' : 'null') +
    ', minTemp=' + (info.minTemp !== null ? info.minTemp + '℃' : 'null'));
  if (info.maxTemp !== null && info.minTemp !== null) {
    lines.push('気温：最高 ' + info.maxTemp + '℃ / 最低 ' + info.minTemp + '℃');
    console.log('  → 表示: 最高 ' + info.maxTemp + '℃ / 最低 ' + info.minTemp + '℃');
  } else if (info.maxTemp !== null) {
    lines.push('気温：最高 ' + info.maxTemp + '℃');
    console.log('  → 表示: 最高 ' + info.maxTemp + '℃（最低気温が取得できなかったため）');
  } else if (info.minTemp !== null) {
    lines.push('気温：最低 ' + info.minTemp + '℃');
    console.log('  → 表示: 最低 ' + info.minTemp + '℃（最高気温が取得できなかったため）');
  } else {
    console.log('  → 気温行を省略しました（理由: JSON・週間予報・スナップショットのいずれからも気温を取得できなかったため）');
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
    var snapshot = loadWeatherSnapshot();

    if (!snapshot) {
      console.log('前回の天気データがありません。終了します。');
      console.log('=== 天気予報 更新確認 完了 ===');
      return;
    }

    var data = fetchWeatherJson(CONFIG.AREA_CODE);
    // 気温のフォールバックは buildWeatherInfo 内で自動処理（loadTempSnapshot 経由）
    var newInfo = buildWeatherInfo(data);

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

  // 気温スナップショットも同時に保存（日付キーで後から参照可能にする）
  if (info.maxTemp !== null || info.minTemp !== null) {
    saveTempSnapshot(info.maxTemp, info.minTemp);
  }
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
// 気温スナップショット管理（日付キー。夕方の投稿向けの気温補完用）
// ============================================================================

/**
 * 今日の日付をキーにして最高・最低気温をスクリプトプロパティに保存します。
 *
 * 17時発表のJSONでは今日の日付の気温データが含まれないことがあるため、
 * 同日中の先の発表（6時台・11時台）で取得した気温を保存しておき、
 * 後の発表で JSON から気温が取得できなかった場合に補完します。
 *
 * 保存キー: WEATHER_TEMP_SNAPSHOT_YYYY-MM-DD
 * 日付が変わるとキーも変わるため、昨日の気温が今日に使われることはありません。
 *
 * @param {number|null} maxTemp - 最高気温
 * @param {number|null} minTemp - 最低気温
 */
function saveTempSnapshot(maxTemp, minTemp) {
  var todayDate = getTodayDateJst();
  var key = 'WEATHER_TEMP_SNAPSHOT_' + todayDate;

  var data = {
    date: todayDate,
    maxTemp: maxTemp,
    minTemp: minTemp,
    savedAt: new Date().toISOString()
  };

  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(data));
  console.log(
    '気温スナップショットを保存しました（キー: ' + key + '）:' +
    ' 日付=' + todayDate +
    ' 最高=' + (maxTemp !== null ? maxTemp + '℃' : 'null') +
    ' 最低=' + (minTemp !== null ? minTemp + '℃' : 'null')
  );
  console.log('  → 保存データ: ' + JSON.stringify(data));
  console.log('  → このデータは、後の発表（11時・17時）でJSONに今日の気温がない場合の補完に使われます');
}

/**
 * 今日の日付に対応する気温スナップショットをスクリプトプロパティから読み込みます。
 *
 * 朝6時台や11時台に取得・保存された今日の気温データを返します。
 * 今日の気温が JSON から取得できなかった場合のフォールバックとして使用します。
 *
 * @return {Object|null} {date, maxTemp, minTemp, savedAt}。未保存の場合は null
 */
function loadTempSnapshot() {
  var todayDate = getTodayDateJst();
  var key = 'WEATHER_TEMP_SNAPSHOT_' + todayDate;
  var json = PropertiesService.getScriptProperties().getProperty(key);

  if (!json || json === '') {
    console.log('今日の気温スナップショットはありません（キー: ' + key + '）');
    return null;
  }

  try {
    var data = JSON.parse(json);
    console.log(
      '気温スナップショットを読み込みました（キー: ' + key + '）:' +
      ' 最高=' + (data.maxTemp !== null ? data.maxTemp + '℃' : 'null') +
      ' 最低=' + (data.minTemp !== null ? data.minTemp + '℃' : 'null') +
      '（保存時刻: ' + (data.savedAt || '不明') + '）'
    );
    return data;
  } catch (e) {
    console.warn('気温スナップショットのパースに失敗しました（キー: ' + key + '）: ' + e.message);
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
    // 気温のフォールバックは buildWeatherInfo 内で自動処理
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
