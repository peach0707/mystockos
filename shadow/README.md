# Forward Data / Shadow Mode 基盤 v0.1

状態：独立した保存・採点基盤を実装。モデル学習・本番売買シグナル・Champion登録／昇格は未実装。実予測の精度は主張しません。PR #1の金融計算・テーマ判定・個人台帳とは接続していません。

## 実装したもの

|要件|実装|
|---|---|
|予測時点入力|原本bytesのSHA-256オブジェクト＋観察manifest。source、available_at、retrieved_at、data_as_of、revision、license_classを保存|
|Prediction Ledger|1テーマ×1期間。固定ID、実際の受領時刻、入力hash、当時のCore・ベンチマーク、model/factor版、予測・確信度・理由を追記|
|Outcome Ledger|5/20/60取引セッションごとの結果。総リターン、超過、費用控除、最大有利／不利変動、方向成否、品質、訂正版を追記|
|状態|pending → scored、またはunresolved → 後日scored。状態イベントも追記|
|版管理|model/factor登録はexperimentalのみ。同じ版の内容変更を拒否。modelはfactor版を固定|
|自動採点|cycle/scoreが成熟済みpendingとunresolvedを検出し、一括採点。中断後の再実行・後日取得に対応|
|原子性|SQLite BEGIN IMMEDIATE＋WAL＋FULL同期。prediction/pending、outcome/scoredを同一トランザクションで確定|
|改変防止|UPDATE/DELETE拒否トリガー、同一ID異内容拒否、読込時hash照合。管理者によるDB改造まで防ぐWORMストレージではない|
|個人情報|個人保有・入出金・配当を取り込まない。稼働DB・原価格は公開gitへ保存しない|

`shadow`と`synthetic`は別DB/namespaceです。合成予測を実運用台帳へ混ぜません。モデルがない場合はObservationのみを保存し、予測を0点・50点等で作りません。

## すぐに再現できる確認

Python 3.12以上。保存・採点本体とテストは標準ライブラリのみです。

```bash
python -m unittest tests.test_shadow -v
python -m shadow.demo --directory /tmp/shadow-demo-new
python -m shadow.cli --db /tmp/shadow-demo-new/synthetic.sqlite3 --namespace synthetic report
```

デモは合成データ専用DBを作り、pending 3件 → 5日目にunresolved 1件 → 入力回復 → 5/20/60日各scoredへ遷移させます。`report.json`とSQLiteバックアップを出力します。既存DBを上書きしません。

## 実データの観察保存（追加市場API 0回）

```bash
python -m shadow.cli --db /private/shadow/ledger.sqlite3 capture --repo /path/to/mystockos
python -m shadow.cli --db /private/shadow/ledger.sqlite3 report
python -m shadow.cli --db /private/shadow/ledger.sqlite3 audit
python -m shadow.cli --db /private/shadow/ledger.sqlite3 backup --output /private/backups/shadow-unique.sqlite3
```

保存対象はregime/themes/data.jsonと4つのconfigファイルの明示allowlist。現在の公開JSONを取得した時点の観察として保存し、過去へ取得時刻を遡及しません。VIXや個別銘柄の異なる基準日は原本内に保持します。生価格や設定の取得失敗は新しい確定manifestを作らず、正常な既存記録を残します。

この観察だけでは寄付・調整系列・将来リターンの採点はできません。

## 予測入力の契約

`ingest --manifest /private/source-bundle.json` は次の記述にあるローカル原本を一括保存します。相対fileはbundleのディレクトリから解決します。APIキーは渡しません。

```json
{
  "definition": {"file":"definition.json","source":"reviewed-config-adapter","available_at":"2026-09-09T21:00:00Z","data_as_of":"2026-09-09","revision":"v1","license_class":"private"},
  "calendar": {"file":"calendar.json","source":"exchange_calendars","available_at":"2026-09-09T21:00:00Z","data_as_of":"2026-09-09","revision":"v1","license_class":"calendar"},
  "features": {"file":"features.json","source":"model-producer","available_at":"2026-09-09T21:00:00Z","data_as_of":"2026-09-09","revision":"v1","license_class":"private"}
}
```

- definition：namespace、theme_id、definition_version、known_at、valid_from、valid_to、core[]、benchmark。各銘柄にentity_id/ticker/exchange/currency。現状はUSDの共通米国株セッションのみ。取引所不明・他市場／通貨は拒否するため、既存entities.csvの未確定exchangeを無理に埋めません。
- core：当時の有効Coreのみ。known_atと発効範囲を確認し、初期等金額を固定。将来の構成入替を期間中に適用しません。
- calendar：exchange=XNYS、source、version、start/end、sessions（date/open/close UTC）、closed_dates。全暦日のカバーを検証。
- features：factor版がrequired_inputsで指定する不変入力。公表日・入手可能性は原本とmanifestの契約に従います。因子の抽出／学習や真偽検証モデルはこのPRの範囲外です。

登録：`register factor VERSION --spec FILE`、`register model VERSION --spec FILE`。共通specはstage=experimental、namespace、code_hash、description。factorはrequired_inputs、modelはtarget=total_return_excess_v1とfactor_versionを追加します。code_hashは生産者が示すコードの識別子であり、コード実行の証明ではありません。

`issue --request FILE` の必須項目は `request_id,theme_id,horizon,model_version,factor_version,input_manifest,prediction,confidence,reasons,cost_model,code_commit`。predictionは `{expected_excess_return: 小数率}`、confidenceは `{kind: unvalidated,value: null,evidence:説明}`。cost_modelはversion/theme_roundtrip_rate/benchmark_roundtrip_rate/assumption。実際の実験モデルから受け取った予測のみを登録します。デモ以外で架空の予測は作りません。

発行時刻は保存プロセスのUTC時計。遅れて受け取った予測を過去へ戻して採点しません。request_idの再送は同内容ならno-op、異内容なら拒否します。

## 評価入口と価格契約

発行時刻より厳密に後の最初の取引セッション寄付 → そのセッションを1日目としてh日目引け。引け後／寄付後発行、休日、短縮取引をカレンダーで扱います。寄付時刻と同時の発行も次セッションです。

新しいカレンダーを生成する場合のみ追加依存をインストールします。

```bash
pip install -r shadow/requirements.txt
python -m shadow.cli --db /private/shadow/ledger.sqlite3 calendar --start 2026-09-01 --end 2027-12-31 --output /private/calendar-new.json
```

版を固定した [exchange_calendars](https://github.com/gerrymanoim/exchange_calendars) を使用し、既存カレンダーを上書きしません。[NYSE公式の休場・短縮取引](https://www.nyse.com/markets/hours-calendars) と照合する運用を前提とします。臨時休場等で凍結カレンダーと実績が合わない場合は欠損として未解決にし、カレンダー改訂と評価契約のレビューが必要です。

採点用manifestには `prices` 原本が必要です。
- namespace、basis=total_return、corporate_actions_complete=true、adjustment_version、source、series[]。
- series：entity_id/ticker/exchange/currency、quality=verified、同じadjustment_version、bars[]。
- bar：session、同一調整基準のopen/close、available_at、quality=verified、tradable_open。
- 初日のopenは正。各日closeは0以上。配当込み・分割調整済みの同一単位の指数を使い、配当を再加算しません。
- 全Coreとベンチマークの全対象セッションを要求します。廃止対価・配当・分割調整が未検証、寄付不可、欠損、将来時刻の情報はunresolvedです。銘柄を除外したり0で埋めたりしません。

`verified_total_return_contract`は提供者の正規化契約を満たしたという品質表示です。実際のコーポレートアクションをこのコードが独自調査して保証する意味ではありません。原データ提供者の調整検証と継続取得は別途必要です。

## 自動採点の実行

```bash
python -m shadow.cli --db /private/shadow/ledger.sqlite3 cycle --repo /path/to/mystockos --price-manifest /private/provider/latest-bundle.json
```

これを永続ディスクのある実行環境のスケジューラから定期実行すれば、新しい原本の取り込み→成熟対象列挙→採点が自動で進みます。価格bundleの取得失敗でも以前の入力とscored結果を破壊しません。DBバックアップはSQLite backup APIを使います。

訂正は新しい価格manifestに対し `score --prices MANIFEST_ID --correction-reason "訂正理由"` を明示します。既定実行ではscored結果を再計算しません。成功した訂正は新outcome_version、失敗した訂正はscoring_errorに追記して旧成功を維持します。

結果単位は小数率。cost_adjusted_return＝theme_return−テーマ費用、cost_adjusted_excess_return＝超過−テーマ費用＋比較側費用。最大有利／不利変動は入口から各日終値までのバスケット累積リターンに0を含めた最大／最小であり、日中の最大値ではありません。

## 現時点の運用上の境界

### 運用試行の記録

`cycle` は `run_started` と `run_finished` を追記します。取得失敗でも既存入力による成熟済み予測の採点を試行し、失敗を成功扱いしません。終了コードは正常0、取得不足・未解決を含む場合2。`report.operations` で未完了runと直近結果を確認できます。強制停止された開始記録は後から消さず、再実行は別runとして残します。スケジューラや保存先自体を新たに契約・稼働するものではありません。

- 保存・再開・自動採点のコードとテストは実装済みです。実験モデル、正規化価格producer、私有の永続ディスク／バックアップ先と常時スケジューラは未接続です。
- GitHub CIは合成DBでの回帰・自動採点のみを実行し、実運用の永続保存を短期artifactに依存させません。既存main/regime/themes/symbolsジョブに変更を加えません。
- 実運用データの外部アップロード、新しいAPI契約・課金・原価格配信は行いません。市場API追加呼出しは0です。
- 保管期限・容量・ライセンスを確認した永続ストレージを接続するまで、毎日の実運用蓄積が稼働しているとは扱いません。今回のローカル観察保存は機能確認です。
- 予測の学習、Walk-forward評価、精度主張、Forward Scoreの本番表示、売買判断、Champion自動昇格は追加していません。
