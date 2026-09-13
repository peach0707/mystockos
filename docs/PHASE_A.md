# Phase A — 表示指標とObservation

対象は期間別リターン、RVOL、既存Strength順位推移、構成銘柄比較の4つだけ。新モデル・売買判断・Forward factorには使用しない。

## 定義

- `config/display_metrics.json`で指標version、1/5/21/63営業日、RVOLの20営業日、中央値、順位の0/1/3/5営業日前を管理。
- XNYSの営業日を明示入力。価格が抜けた日を飛ばして「5本前」等へ短縮しない。対象営業日と終値が揃わなければnull。値0と欠損を区別する。
- リターンは同一取得版の日足終値比率。テーマは当日の有効Coreのうち計算可能な銘柄の均等平均。Strengthとは独立。役割・membership・benchmark定義は変更しない。個別比較にはCore/Related/Watchを含める。
- RVOLは当日出来高÷当日を除く直前20営業日の出来高平均。テーマは有効Coreの中央値。1倍超の銘柄数と有効銘柄数を併記。出来高欠損・平均ゼロはnull。
- Strength順位は既存UIのranked/status=ok/有限Strength、安定降順・同点時原順序をそのまま使用。履歴のない営業日はnull。現在構成で過去順位を再計算しない。
- 各値にas_of、source、adjustment、price_basis、status、eligible_n/total_n/coverage。取得原文hash、取得時刻、membership snapshot/hash、metric config/version、元の公開入力hashも保存。
- 期間リターンを当時の投資可能な正式バックテストとは扱わない。当日の構成による表示指標で、保存後のObservationを書き換えない。

## 価格供給元と予算

独立した`TwelveProvider.fetch`をprovider境界にする。Basic 8の日足100本を取得。APIキーはActions SecretsからAuthorizationヘッダーにのみ渡す。ブラウザへキーを渡さない。
`data_source=Twelve Data / adjustment_type=provider_default_daily_split / split_adjusted=true / dividend_adjusted=false / price_basis=price_return`。
分割調整は[提供元FAQ](https://support.twelvedata.com/en/articles/5179064-are-the-prices-adjusted)に基づく属性で、分割イベントの独立照合済みという意味ではない。配当込みTotal Returnではない。

新しい公開側workflowはUTC火〜土02:17（日本時間11:17）。1回最大120リクエスト、現在の全tickerは102。16秒間隔で1分4件以下、毎時00〜04/30〜34分は新規要求を待つ。429は即停止、timeoutは欠損、同じ実行で再試行しない。公開既存約317＋Private側上限160＋Phase A上限120なら通常目安597credits/UTC日。手動再実行や他のキー利用は別途加算されるため、800/日を全体として保証するものではない。
旧API処理・スケジュールは変更しない。Private側から公開repoへ書く新トークンは不要。

## 保存と失敗

`data/phase_a.json`は最新表示用。`data/phase-a-observations/YYYY-MM/<hash>.json`は不変の観測記録。全価格取得失敗時や同日coverage悪化時は正常なlatestを維持し、失敗状態の新しい観測記録は別に残す。旧基準日を最新日として表示しない。
Private側の独立sidecarが公開データを時点付きで取り込み、`display_observations/YYYY-MM/<hash>.jsonl`へ追記。Prediction/Outcome/Statusの既存仕様と処理は変更しない。Observationへの保存はモデルfactorへの採用ではない。

## UI

一覧には5営業日前比の順位差だけを追加。詳細には期間別リターン、RVOL、順位履歴、4種の並び替えができる構成銘柄行。正は赤・負は緑。横長テーブルは使わず、4列の数値を銘柄ごとに表示。ホーム・ナビ・pager.js・既存app.cssは変更しない。並び替えは詳細の比較行だけを更新する。

## 検証と未完了事項

ローカル：Node 61、Python 38（新規指標12含む）、Frozen 8ファイル完全一致、config validation成功。Private既存42＋sidecar2テスト成功。
初期表示は実際に保存された2026-09-11の日足69銘柄を使用し、追加API取得なし。未取得の構成銘柄はnull。生成時点をknown_atに記録し、過去に生成済みとは扱わない。
公開Theme System出力は2026-09-08のままのため、09-11現在の順位は推定しない。既存日次Observationもas_of不一致をunresolvedとして記録中。予測は発行しない。
確認ブラウザがローカル接続を拒否したため、iPhone Safari/PWA実機・375/390/430px描画確認は未完了。画面合格やPhase A完了とは扱わず、PRレビューで確認を残す。CSS Scroll Snap本体と既存グローバルCSSはバイト一致を確認する。
このブランチはmainへ自動マージしない。Phase Bへ進まない。
