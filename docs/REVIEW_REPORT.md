# PR #1 再レビュー報告（追加指示1〜11対応）

mainは未マージ。Forward Engine本番ロジック・売買シグナル・Shadow基盤の実装は行っていない。設計承認を反映し、今回は会計修正・テスト・次フェーズ計画までで停止する。

## 1. 変更ファイル

今回、直前のc6e2726から追加変更するファイル：

|ファイル|内容|
|---|---|
|assets/js/accounting.js|実入金日ごとの配当抽出を追加。期間会計と分離|
|assets/js/portfolio.js|日付詳細の全項目、未分類、配当入金日、休場の表示|
|assets/js/state.js|任意の配当権利日・イベントIDの保持/検証|
|assets/js/views.js|Forward Engine 検証中と現在段階の明記|
|tests/ledgers.test.js|今回6件追加。祝日、週末表示、入金日、未分類、将来メタデータ、明示休場|
|docs/REVIEW_FIXES.md|完全版指示を受領した最新仕様|
|docs/UI_V2.md|更新した会計/表示の説明|
|docs/VALIDATION.md|最新のテスト記録|
|docs/SHADOW_IMPLEMENTATION_PLAN.md|Forward Data / Shadow Modeの段階別実装計画|
|docs/SAFARI_ACCEPTANCE.md|main未マージで行う実機確認手順|
|docs/REVIEW_REPORT.md|本報告|

前回のレビュー修正で既にPRへ反映済み：ledger.js（期間境界）、app.js（台帳入力/CSV）、accounting.js（評価間損益/年初来）、state.js（3台帳/移行）、portfolio.js/views.js（台帳画面）、tests/app.test.js/ledgers.test.js、ui-regression.yml、関連資料。これらの会計修正も今回の全テストに含めている。

## 2. 損益ロジック

日次運用損益＝今回の有効資産評価−直前の有効資産評価−期間内の純入金。

営業日カレンダーを使って入力を強制せず、有効評価の順番で比較。土日・祝日を埋める必要はない。入金/出金は評価の有無と独立した台帳で期間合算する。金曜5,000万→月曜5,100万は入出金なしなら+100万、休日100万入金なら0円。

年初来運用損益＝最新有効評価−年初基準評価−その間の純入金。毎日の評価は不要。基準不足、履歴不完全、時刻境界不明はデータ不足。資産増減と運用損益を区別する。

配当は実入金日・税引後金額×記録FX。台帳から総資産へ再加算せず、参考税額を二度引かない。評価のない入金日にも配当を表示し、比較期間内の配当とは区別する。権利落ち日等は任意のメタデータまでで、未収/Total Return計算は将来拡張。

## 3. テスト

ユーザー指定6ケースすべてを含む：金曜→月曜、間の入金、祝日、疎な年初来評価、入出金履歴不足、入金日配当と二重加算防止。

加えて、入出金の差引0、無効評価、timestamp端点、CSV、旧v2移行、保存失敗、未分類、週末と明示休場の「—」、配当メタデータ、公開JSON失敗、既存テーマ画面を確認。

Node25件成功。Python出力保護6件成功。合計31件。JavaScript10モジュールの構文/importも確認する。

## 4. 検証コマンド・CI

- node --test tests/*.test.js
- python -m unittest discover -s tests -p 'test_*.py'
- python tests/check_frozen.py
- python config/validate_theme_config.py

上記ローカル検証は成功。GitHub CIはこの変更をPRへpush後に再実行し、最新コミットの結果を確認して会話とPRに報告する。以前のコミットの緑チェックを今回の結果として扱わない。

## 5. Theme System v1.0

凍結8ファイルは基準コミット4e82b3eのGit blob SHAと完全一致。Strength/Velocity/Heat/Turning、設定、従来の株価・市場更新を変更していない。今回のコミットに公開データJSON/JSONLや計算コードの変更はない。

設定検証：29テーマ、104エンティティ、121所属、Home Core重複0、Space規則成功。thinの横断順位禁止、観察nullを0へ補完しないルールも維持。

## 6. iPhone Safari実機確認

[手順書](SAFARI_ACCEPTANCE.md)を参照。未実施であり、実機確認済みとは報告しない。PRブランチを別originのHTTPS確認環境で配信することが前提。確認URLは今回発行していない。現在の本番URLではPRの変更はまだ確認できない。

架空の2評価と休日入金を入力→カレンダーの金額・「—」→入金日配当→年初来・不完全状態→バックアップ/CSV→タブ再起動→固定ナビ/入力/スクロールの順に確認する。

## 7. 次フェーズ

[Forward Data / Shadow Mode実装計画](SHADOW_IMPLEMENTATION_PLAN.md)：契約とfixture→時点入力保存→Prediction Ledger→Outcome Ledger→独立Shadow運用→検証レポート。

予測はprediction_id/issued_at/theme_id/horizon/model/factor/input_manifest/prediction/confidence/reasonsを不変記録。結果は5/20/60営業日後のtheme/benchmark/excess/cost-adjusted、最大上昇下落、quality/versionを追記。pending/scored/unresolvedは追記イベントから導出する。

未検証モデルをChampionにせず、自動変更/自動昇格、現構成の遡及正式バックテスト、本番買い/売り表示は禁止。精度を主張しない。計画を提出して再レビューを待つ。
