# 将来予測・判断処理：独立した検証レイヤー

2026-09-13。ユーザーの「運用確認しつつ将来予想や売買判断まで作って」に対応。

## 今回実装した範囲

`research/` は既存UI、手動判断enum、会計、Theme System、従来のSQLite
Shadow Engineから独立しています。5 / 20 / 60米国営業日のテーマ価格リターンと
固定ベンチマーク価格リターンとの差を予測します。既存のtotal-returnターゲットを
価格リターンへ読み替えず、`theme_price_excess_next_open_v1` を新設しました。

- 学習候補：観測済み5営業日テーマリターンを説明変数にした単回帰。係数は訓練データで
  推定し、訓練期間平均のベースラインと比較します。恣意的な合成スコア配点はありません。
- これは最初の検証候補です。Phase Aの指標を正式Forward factorへ昇格しません。
- 学習は明示的なCLI操作だけです。日次の自動再学習、モデル切替、Champion昇格はありません。
- モデル、入力、価格根拠、カレンダー、予測、結果のhashを保持します。
- Predictionとは別に棄権レコードを保存します。履歴不足をゼロ予測に置き換えません。
- 予測は実行時時計で発行し、呼出側の過去日時は使用しません。
- 成熟した予測は`pending → scored / unresolved`。不足した構成銘柄の除外再配分をしません。
- 元予測と既存Outcomeは不変。訂正バージョンを発行するCLIは今回未実装です。

## 時点整合性

Private archiveの正規化済みObservation Outcomeを学習ラベルとして読みます。
これは過去に予測を出したという意味ではありません。特徴量は当時保存されたPhase A
sidecarのみを使用し、当時のCore、as_of、benchmark、調整方式を照合します。
sidecarが主Observationより後でも同じ次営業日の寄り付きより前なら、両方が揃った
実際の時刻を学習標本の起点にします。後日の現在構成や最新特徴量を遡及利用しません。

各walk-forward時点では、ラベル期間が終了し、結果が取得済みの標本だけで学習します。
同時点のテーマ群をまとめてOOSにし、未来期間が重なる訓練ラベルを除外します。
ランダム分割やOOSでのパラメータ最適化はありません。

実データの最低条件は訓練120個・OOS60個の異なる入口営業日です。相関したテーマ行数で
水増ししません。この数は精度保証ではなく保守的な実行条件です。60日予測ではラベルの
成熟も待つため相応の蓄積期間を要します。合成テストだけ小さい条件を使えます。

## 出力と判断

- 期待超過価格リターン（小数単位）
- 過去OOS残差の10～90百分位を加えた経験的誤差帯
- 確信度は未検証、勝率なし、Forward Scoreなし、失速リスクなし
- 手数料等の明示された増分コストを超えて誤差帯全体が正なら、未保有者は
  「新規買い候補（検証用）」、保有者は「保有継続候補（検証用）」
- 誤差帯全体が負なら「見送り候補（検証用）」／「縮小候補（検証用）」
- 誤差帯が跨ぐ場合は判断待ち、予測・コスト不足時は判定保留

この判断方針も未検証のpaper policyです。誤差帯は校正済み信頼区間ではありません。
実注文、公開アプリの買い・売り表示、個人保有の更新には接続していません。
本番への接続には、別期間の確認、レジーム別性能、売買回転・コスト・ドローダウン、
確率校正、判断policyの検証と人間のモデルレビューが残ります。現時点で優位性を主張しません。

## 価格と採点

次の取引可能セッションの寄り付きから5 / 20 / 60番目の引けまで、時点固定Coreを
初期等ウェイトで保有した価格リターンを採点します。毎日リバランスしません。
data_source / adjustment_type / split_adjusted / dividend_adjusted / price_basis を必須記録。
当面は配当込みを確認できない価格リターン。調整仕様の変化はunresolvedです。
コスト未指定のOutcomeはcost_adjusted_return=null。MFE/MAEは日足終値ベースで、
日中高安とは区別します。既存provider abstractionを変更しません。

## 操作

Private archiveをローカルに取得し、`shadow.calendar.generate`で十分な期間のXNYS
カレンダーJSONを用意します。出力やSQLiteはPrivate側またはローカルだけへ置きます。

```sh
python -m research audit-archive --archive /private/shadow-data --calendar /private/calendar.json
python -m research train --archive /private/shadow-data --calendar /private/calendar.json --horizon 5 --output /private/model-5.json
python -m research issue --db /private/research.sqlite3 --model /private/model-5.json --snapshot /private/input.json --calendar /private/calendar.json --request-id UNIQUE_ID --cost 0.002
python -m research score --db /private/research.sqlite3 --request-id UNIQUE_ID --prices /private/prices.json
```

20 / 60日も別モデルとして明示的に学習します。`train`は既存モデルファイルの上書きを
拒否します。`issue`は同一ID・同一入力なら再利用し、異なる入力なら拒否します。
入力契約の例は合成テストを参照。合成namespaceを実データに混ぜられません。

## 2026-09-13の運用確認

Private main `cbfd974`：JSONL計600件、価格207件、manifest15件、Phase A sidecar1件。
成熟Outcome・実予測は0件。既存日次保存は成功していますが、テーマ出力as_of不一致を
引き続きunresolvedとして扱っています。今回の実データ学習結果は全期間
`insufficient_matured_history`。過去値の作り直し・架空予測は行いません。

既存日次Observationを継続し、実予測の自動日次発行はまだ有効化しません。
本実装は明示実行できる検証用処理です。予測精度と日次予測運用の完成を意味しません。
