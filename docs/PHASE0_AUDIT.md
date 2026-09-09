# 株ゴリラ🦍 — Phase 0監査と実装計画

監査日：2026-09-09。対象：`peach0707/mystockos` main **4e82b3e85375df913308f75826df1cb45d24baf9**。画面仕様は今回の開発指示、UI参照は提出PDF。過去チャット全文を読んだという扱いにはせず、今回の明示仕様とリポジトリを根拠にした。

提出前に最新main **85535149110fa1516e6b012a453508f3a9a5f750** を追加確認。差分はdata.jsonの更新時刻だけで、株価・計算・設定は同一。この最新コミットをPRの基点として取り込む。

作業ブランチ：`feature/kabugorilla-v2-phase1`。正式表示名を株ゴリラ🦍に変更するが、リポジトリ名・内部識別子・既存計算は維持する。

## 監査対象と現在の状態

|対象|確認結果|
|---|---|
|画面構成|約16KBのindex.htmlにCSS・JS・表示が同居。市場、テーマ、固定監視銘柄、サンプルのニュース等を含む1ページ。保有資産会計なし。|
|データフロー|Twelve Data → ActionsのPython → 保存JSON/JSONL → git commit → GitHub Pages → ブラウザ。VIXはCboe、代替FRED。ブラウザにプロバイダのAPIキーは渡さない。|
|GitHub Actions|株価更新、市場更新、テーマ更新、設定検証、およびPages。取得時の最新一覧に株価更新・Pages成功あり。全過去実行の成功までは確認していない。|
|data/regime.json|基準日9/8、市場Bull・Trend70.87・信頼度Medium、半導体Neutral45.91。不安定度17.73。VIX15.3は9/7。市場とVIXの基準日が不一致。|
|data/themes.json|schema/profile1.0。基準日9/8。29テーマ：ranked5、thin8、heat_only8、none8。20テーマ利用可能、memory_hbm不足、8テーマ観察用。|
|data/theme_history.jsonl|9/8の正式履歴1行。Forward Engineの再現検証に十分な蓄積はまだない。同一as_of再実行は履歴を追加しない。|
|config/themes.csv|定義発効日9/8。分類、比較対象、ベンチマークを保持。|
|config/entities.csv|104エンティティ。内部ID・銘柄対応は凍結。|
|config/memberships.csv|121所属。Home Core重複エラー0。時点付き所属を遡及変更しない。|
|config/scoring_profiles.json|v1.0の窓・配点・閾値。変更対象外。|
|scripts/update_themes.py|日足取得、計算、テーマ選別、出力、履歴を担当。約45KB。既存のStrength/Velocity/Heat/Turningをそのまま維持。取得失敗しても縮小した有効集合で結果が出るため、正常データを劣化した候補で置換する余地がある。|
|.github/workflows/themes.yml|平日23:30 UTC、手動dry_run既定true、30分上限。SPY＋追加70銘柄。単独concurrencyも出力品質保護も監査時はなし。保存時plain git push。|
|.github/workflows/main.yml|平日30分ごと、5銘柄の日足更新。通常48回/日。全5銘柄成功後の書き込み、429等の再試行、push前rebaseあり。変更しない。|
|.github/workflows/regime.yml|平日22:30 UTC。6銘柄＋VIX。取得と計算がYAML内。既存の一時出力・再試行を保持。変更しない。|

設定バリデータは29テーマ／104エンティティ／121所属で成功。Spaceの凍結ルールも成功。

## 再利用・保護・追加

**再利用**：既存JSON、所属と分類、相対評価、公開日足、GitHub Pages、設定バリデータ。UIはranked5内の順位だけを表示し、thinを横断順位に混ぜない。HeatのみのテーマにStrengthを補完しない。観察テーマのnullスコアを0に変換しない。

**保護**：計算コード・設定・従来の株価/市場ワークフローは8ファイルのGit blob SHAで回帰確認。`themes.json`の意味を変えず、`theme_history.jsonl`も過去行を書き換えない。SPCX overlayは既存スコア外のまま。新予測は別レイヤー、今回未実装。

**追加**：表示名、5画面＋歯車設定、独立CSS/データ取得/端末状態/会計/画面、端末内の保有・監視メモ・評価・配当・ニュース、最後に取得できた公開データのキャッシュ、取得失敗の表示、回帰CI、テーマ出力の保護ラッパー。

## データ取得コストと制約

|更新|通常呼出し数/回|通常頻度|平日あたり|
|---|---:|---|---:|
|株価|5|48回|240|
|市場|6＋VIX外部取得|1回|6 time_series|
|テーマ|71|1回|71|
|合計|—|—|**317 time_series**＋VIX|

上表はソースからの静的見積もり。再試行・手動テストは別。フルテーマテスト1回につき約71呼出し、通常9〜10分。今回のUI追加に伴う新規市場API呼出しは0。ブラウザは既存JSONを読むだけ。

Twelve Data公式のBasicは8credits/分・800/日。time_seriesは1銘柄1creditで、batchも銘柄分消費する。実アカウントの契約内容は未確認。日次合計より22:30/23:30の複数workflow重複が429リスクになる。既存日足の30分更新は重複取得が多いが、今回は正常更新頻度を維持した。[Twelve Data料金・クレジット](https://twelvedata.com/pricing)

無料枠で全銘柄を取得できるとは限らない。CYBRはログでPro/Venture対象と返されている。勝手な課金・代替銘柄化・提供元変更はしない。公開表示の権利は回数枠と別条件であり、契約プランに応じた確認を残す。

GitHubの標準ホストrunnerは公開リポジトリで無料。大きいrunner等は別条件。scheduleは時刻の保証がなく、混雑で遅延・脱落する場合がある。最短5分、既定ブランチ上で動き、公開リポジトリの60日無活動で停止し得る。UTC cronは米国夏冬時間と一致し続けるとは限らない。[Actionsの課金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)、[schedule仕様](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 不具合・不足の扱い

1. **memory_hbm不足**：MUは十分、SKHYの取得履歴が短い。既存必要銘柄数・履歴窓を短縮しない。不足として表示する。
2. **CYBR未取得**：Cybersecurityは他の4 Coreで利用可能。欠損を明示。取得不能を0価格で埋めない。
3. **市場ストレス連携**：市場側は`market_stress.active`、テーマ側`regime_stress_active()`は`stress.active`を参照する。現在どちらも実質falseなので差が表面化していない。修正はTurning等の判定結果に影響し得るため凍結下で行わず、独立レビューが必要。
4. **VIX基準日**：`missing_data:false`でも市場とVIXの日付が異なる。UIにVIX自身の日付と不一致を表示。計算を勝手に再構成しない。
5. **取得失敗保護**：凍結エンジンを一時ディレクトリでそのまま実行。候補の新規Core欠損、有効銘柄数減、既存スコア喪失、定義差分、日付後退、履歴破壊は候補全体を拒否。以前からのmemory/CYBR不足は許容。古い銘柄と新しい銘柄のデータ混合はしない。成功候補のみ2ファイルを同一Gitコミットで公開する。
6. **push競合**：テーマと株価の同時pushは失敗し得る。安全側に失敗して次回更新を待つ。今回同じテーマworkflowの同時実行だけを直列化し、アカウント全体のAPI予算共有までは追加しない。

## 実装順序と検証

1. Phase0：最新mainを固定、仕様・既存データを確認、凍結SHA基準を作成。
2. Phase1：ハッシュルーティングで5画面と設定、データ層と状態層を分離。サンプルニュースは実データとして見せない。
3. 保有：円建て日次評価と入出金、実入金配当、カレンダー・年初来・寄与明細。個人情報はlocalStorageだけ。
4. ニュース：手動登録できる枠と共通スキーマ、一次情報確認状態、X下書き。自動収集は未接続。
5. Forward Engine：独立した研究・検証設計を提出して停止する。

回帰はネットワーク費用を使わず、凍結ファイル同一性、実際の29テーマの画面変換、nullデータ、入出金・配当・未記録・訂正、CSV、保存容量失敗、429/timeout/壊れたJSON、候補劣化時の元ファイル不変を検証する。実機iPhone Safariでのタップ・スクロール・ホーム画面追加確認と、本番APIの再実行は未実施。画面の静的実装と実機受入確認は区別する。
