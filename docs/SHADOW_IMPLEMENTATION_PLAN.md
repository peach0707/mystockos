# Forward Data / Shadow Mode — 次フェーズ実装計画

状態：計画のみ。設計方向はユーザー承認済み。このPRでは入力収集ジョブ、予測モデル、Prediction/Outcome Ledgerの実処理を実装しない。正式テーマ履歴が少ないため予測精度を主張しない。mainマージ・本番売買判断・Champion登録は行わない。

## 目的と分離

「予測時に何を知っていたか」「どう判断したか」「後日どうなったか」を原本と版から再現する。Theme System v1.0をread-onlyで参照する独立レイヤーにする。現在の構成銘柄を過去へ遡及して正式バックテストとすることは禁止。個人保有・入出金・配当台帳は取り込まない。

5/20/60米国営業日、ベンチマーク超過リターン、発行後の次の取引可能セッション入口、Point-in-time構成、Walk-forward/OOSを維持する。観察と予測を別レコードにし、まだ予測がなければ「観察履歴」として保存する。空欄を50点や勝率で埋めない。

## 実装順序と完了条件

|段階|実装対象案|完了条件|
|---|---|---|
|D0 契約・fixture|schemas/input-manifest、prediction、outcome、status-eventと検証CLI|必須型・版・時刻・ID・参照hashの不整合を拒否。合成fixtureは明示し本番台帳に入らない|
|D1 入力時点保存|独立captureコマンド、content-addressed原本、定義スナップショット|同じ入力の再取得で重複せず、改訂は別版。取得失敗で正常原本を破壊しない|
|D2 Prediction Ledger|append-only追記、冪等ID、モデル/因子/入力参照、理由|過去予測を訂正・削除しない。再実行は同じID/同内容ならno-op、異内容なら拒否|
|D3 Outcome Ledger|sessionカレンダー、成熟対象列挙、リターン計算、版付き結果追記|休日・遅延発行・途中欠損・廃止・訂正のfixtureを再現。5/20/60別に採点|
|D4 Shadow運用|独立workflow、単一writer、再開・失敗記録・容量監視|予算超過/429/timeoutでも既存更新に影響せず、追記の途中失敗から回復できる|
|D5 振り返り|検証用レポート、カバレッジ・未採点・品質・再現性|モデルの精度表より先にデータ品質を提示。実データによる検証と合成テストを混同しない|

D0→D1まででも有用な履歴を蓄積できるが、D1完了だけで予測・精度を名乗らない。モデルの訓練・選定は別の研究計画。Challengerが生まれても自動昇格しない。

## 入力履歴とinput_manifest

保存契約案：manifest_id、captured_at、issued_cutoff、source、source_record_id、source_available_at、retrieved_at、data_as_of、session、content_hash、raw_object_ref、schema_version、revision、license_class、config_commit、definition_version、calendar_version、missing_fields、quality。

- `data_as_of`（観測日）と`available_at`（利用可能日時）を別に持つ。予測では実際のavailable_atがissued_at以下の原本だけを参照する。古い観測日でも後日初めて取得した改訂値を当時の入力にしない。
- ソースごとの基準日を保持する。VIX・市場・テーマの日付が異なる場合、一つのas_ofに均して最新と扱わない。
- 時点付きCore/Related/Watch、ticker/取引所/通貨、上場・廃止・社名変更、ベンチマーク、known_at/valid_from/toを定義原本ごと保存する。後日の所属変更で過去原本を再構成しない。
- 初期の既存JSONアーカイブは追加市場API呼出し0で行える。ただし既存themes.jsonは原価格系列を含まないため、これだけで全因子再計算や将来リターン算出が可能とは扱わない。
- 完全な再現に必要なOHLCV・調整・配当・分割・ベンチマーク等は別collectorで保存する計画。凍結update_themes.pyへ無断で保存処理を混ぜない。実装時に必要銘柄の和集合と取得単価を確定し、重複取得を抑える。
- データ不足のcaptureは品質付きで保存可能だが、入力manifestが不足している予測を実行可能と表示しない。

原本はchecksum付きの不変オブジェクト。大容量または再配布制限のある原価格は公開gitへ入れない。保存先は実装着手前にアクセス権・保持期間・バックアップ・契約を確定する。予測台帳に個人の保有有無を保存しない。

## Prediction Ledger

予測ごとの必須契約案：

- prediction_id、issued_at（UTC）、theme_id、horizon（5/20/60）、model_version、factor_version。
- input_manifest（不変manifest ID＋hash）、definition_version、calendar_version、benchmark。
- prediction（型・単位・値・対象ラベル）、confidence（充足率・標本数・区間等の別オブジェクト）、reasons、counter_evidence。
- entry_rule、target_definition_version、cost_model_version、run_id、code_commit、record_hash。

1テーマ×1horizonで一意の記録。冪等キーはissued_at/theme_id/horizon/model_version/input_manifest hashの組合せを基にする。同じ実行を再試行しても新しいprediction_idを増やさない。同じIDの内容変更は拒否する。

実予測に必要なモデルが未作成ならObservation Ledgerへ保存し、Prediction Ledgerに空の予測や架空スコアを置かない。合成テストは別namespace/保存先にする。Shadowモデルはexperimentalと明記し、未検証Forward Scoreを勝率としてUIに出さない。confidenceとpredictionは別で、値が高いことを確信が高いことに置き換えない。

## Outcome Ledgerと成熟日

予測のissued_at後に来る最初の取引可能セッションの寄付を入口にする。実行ジョブが遅れて既定入口を過ぎた場合、issued_atを改ざんせず実際に使えた次のセッションを確定する。米国営業日カレンダーと休場/短縮取引の版を保存し、入口からh日目の引けを出口とする。

必須結果：prediction_id、horizon、entry_session/time/price_ref、exit_session/time/price_ref、scored_at、theme_return、benchmark_return、excess_return、cost_adjusted_return、max_favorable_movement、max_adverse_movement、result_quality、outcome_version、outcome_input_manifest、record_hash。

- 予測時の有効Coreと初期重みを固定し、期間内の銘柄の事後入替をしない。買収・分割・配当・上場廃止の処理規約も版付き。価格欠損を0または銘柄除外で処理しない。
- 超過リターンは同じ入口/出口のtheme return−benchmark return。cost_adjusted_returnはtheme_return−テーマ側の同期間取引費用率と定義する。別途cost_adjusted_excess_returnを（theme_return−テーマ費用率）−（benchmark_return−比較側費用率）として保存できる。費用控除版は手数料・スプレッド・滑りのモデルと単位を保存する。実費データがなければ費用想定として明記する。
- 日足のみの初期案ではmax favorable/adverse movementは入口から各日終値までの累積リターンに初期0を含めた最大値（0以上）/最小値（0以下）。イントラデイの最高/最低約定とは主張しない。バスケット各銘柄の別時刻の高値を足して同時刻の最高値にしない。
- 調整済み株価に配当が含まれる場合、配当を再加算しない。raw price＋corporate actions方式ならcash distributionを1回だけ反映する。個人台帳の税引後配当と研究用のTotal Returnは独立した契約とする。
- 元結果に誤りが見つかれば新しいoutcome_versionと訂正理由を追記し、predictionと旧outcomeは残す。

## pending / scored / unresolved

状態は追記イベントから導出する。既存行のstatusを上書きしない。

|状態|意味|次の扱い|
|---|---|---|
|pending|成熟セッション未到来、または成熟後の採点待ち|次回ジョブで期限到来を検出。未採点が滞留すれば監視通知候補|
|unresolved|成熟したが価格・調整・廃止処理・manifest等が不足して確定不能|理由・不足項目・attempt・retry_afterを記録。後日回復すれば新outcome版を追記|
|scored|必要データと品質検証が揃って採点済み|後日訂正も新outcome版。過去の成功/失敗を消さない|

状態イベント：event_id、prediction_id、horizon、at、status、reason_code、outcome_version、run_id。一回の公開単位をmanifestで確定し、結果行だけ追記して状態イベントが落ちた等の中途半端な実行は未コミット扱いにする。

## Append-onlyの実装方式案

日付単位のJSONL shard＋不変commit manifest、またはトランザクション付き保存基盤を候補とする。単純なJSONL追記だけで完全な原子性があるとは見なさない。

単一writer、書込前schema/hash検証、staging、確定manifestの順。読み手は確定manifestが参照するレコードだけを見る。content-addressed原本とprediction/outcome/statusそれぞれのhashを照合する。既存IDの異内容上書き、過去shard削除、予測後の入力差し替えを拒否。再実行・途中強制終了・重複IDのテストを必須にする。

## 運用・予算と既存機能の保護

既存の公開JSON保存だけの段階は新しい市場APIを呼ばない。原価格collector追加時は対象銘柄数×回数×endpoint weight＋retryを見積もり、既存ワークフローとAPIキー全体の予算を共有する仕組みを先に設計する。具体的契約枠は実装時に再確認する。

429ではRetry-After、timeoutでは上限付きbackoff/jitter、取得済み入力は再利用する。欠損・失敗は記録し、正常な既存原本を置換しない。Shadowの失敗でmain/regime/themesの通常更新を停止させない。workflowの完了時刻を市場の確定時刻として流用しない。

長期原本の保存先とライセンスが未確定のまま、公開gitや短期artifactへ大量の価格履歴を置かない。今回、追加APIの実行・契約・課金は行っていない。

## 受入テストと禁止事項

受入テスト：公表前データ参照拒否、未来の構成変更の漏洩拒否、timestamp不一致、カレンダー休日/短縮/遅延発行、重複リトライ、ハッシュ改ざん、途中停止、429/timeout/部分失敗、廃止/分割/配当、費用符号、5/20/60独立成熟、outcome訂正版、不明結果のunresolved維持、完全オフライン再現。

禁止：本番「新規買い候補」「売却」の自動表示、未検証スコアの勝率表示、未検証モデルのChampion扱い、AIによるモデル自動変更、Challenger自動昇格、現構成の遡及正式バックテスト。失速リスクを100−Forward Scoreとはしない。校正前の精度主張をしない。

UIは「Forward Engine 検証中」と段階を併記し、観察/基盤未実装/Shadow採点中を区別する。この計画をレビューした後で次フェーズの実装範囲を確定する。
