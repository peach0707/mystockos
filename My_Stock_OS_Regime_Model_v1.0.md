# My Stock OS — Regime & Theme Rotation Model v1.0

Version: 1.0

Purpose:
個人用の米国株・半導体投資アプリにおいて、売買シグナルではなく「現在の市場環境」を前営業日終値ベースで把握する。

---

# 1. 基本原則

- ザラ場の値動きではなく、前営業日までの確定日足を使用する。
- Regime判定は原則1日1回、米国市場引け後に更新する。
- AIにBull/Bear判定を任せない。
- 数値ロジック → Regime判定 → AIによる自然言語説明、の順にする。
- TrendとInstabilityは別軸で扱う。
- 売買シグナルは出さない。
- スコアだけでなく、各因子スコア・ラベル・データ基準日を毎日保存する。
- 閾値はv1.0として固定し、バックテスト結果に合わせて頻繁に最適化しない。
- 欠損データは前日値で補完せず「データ不足」とする。
- 株式分割・配当調整を含め、可能な限り調整後価格を利用する。

---

# 2. Market Trend Score / 市場トレンド

目的:
現在の米国株市場が以下のどこにいるか判定する。

- Strong Bull / 非常に強気
- Bull / 強気
- Neutral / 中立
- Bear / 弱気
- Strong Bear / 非常に弱気

Score: 0〜100
高いほどBull。

## 因子とWeight

QQQ vs 200DMA：35%
QQQ 63営業日Return：25%
QQQ 50DMA / 200DMA：15%
RSP / SPY 63営業日Relative Strength：15%
HYG / LQD 63営業日Relative Strength：10%

Market Trend Score
T = Σ(weight × factor score)

各Factorを0〜100に区分線形変換する。

## QQQ vs 200DMA

-12% → 0
-6% → 25
0% → 50
+8% → 75
+16% → 100

## QQQ 63日Return

-18% → 0
-8% → 25
0% → 50
+10% → 75
+22% → 100

## QQQ 50DMA / 200DMA

-6% → 0
-2% → 25
0% → 50
+2% → 75
+6% → 100

## RSP/SPY 63日RS
## HYG/LQD 63日RS

-8% → 0
-3% → 25
0% → 50
+3% → 75
+8% → 100

## Raw Score目安

75〜100：Strong Bull
60〜74：Bull
45〜59：Neutral
30〜44：Bear
0〜29：Strong Bear

実際の表示ラベルにはHysteresisを適用する。

---

# 3. Hysteresis / Regime State Machine

スコア境界付近でラベルが毎日切り替わるのを防止する。

## Strong Bull

Entry:
T >= 78 が2営業日連続

Exit:
T < 68

## Bull

Entry:
T >= 62 が2営業日連続

Exit:
T < 52

Strong Bull条件を満たせばStrong Bullへ。

## Neutral

デフォルト状態。

Bullへ:
T >= 62 が2営業日連続

Bearへ:
T <= 38 が2営業日連続

## Bear

Entry:
T <= 38 が2営業日連続

Exit:
T > 48

Strong Bear条件を満たせばStrong Bearへ。

## Strong Bear

Entry:
T <= 22 が2営業日連続

Exit:
T > 32

生スコアTは毎日保存する。

Regime Labelとは別に表示できるようにする。

Regime継続営業日数も保存する。

---

# 4. Semiconductor Regime / 半導体レジーム

目的:
半導体セクターそのものの絶対的な強さと、NASDAQに対する相対的な強さを判定する。

Score: 0〜100

## 因子とWeight

SOXX vs 200DMA：30%
SOXX 63営業日Return：25%
SOXX / QQQ 63営業日RS：30%
SOXX 21営業日Return：15%

## SOXX vs 200DMA

-15% → 0
-7% → 25
0% → 50
+10% → 75
+20% → 100

## SOXX 63日Return

-24% → 0
-10% → 25
0% → 50
+12% → 75
+24% → 100

## SOXX / QQQ 63日RS

-10% → 0
-4% → 25
0% → 50
+4% → 75
+10% → 100

## SOXX 21日Return

-12% → 0
-5% → 25
0% → 50
+6% → 75
+12% → 100

LabelはMarketと同じ5段階を使う。

ホーム画面では絶対Scoreに加えてSOXXのQQQに対する63日Relative Strengthも表示する。

例:

Semiconductors / 半導体
Strong Bull
86 / 100

vs QQQ 63D
+11.8pt

---

# 5. Instability Score / 不安定度

目的:
Bull/Bearとは独立して、市場の不安定さ・ストレスを測る。

Score: 0〜100

高いほど不安定。

## 因子とWeight

VIX水準：40%
QQQ 20日Realized Volatility：35%
QQQの20日高値からのDrawdown：25%

## VIX

13 → 0
16 → 25
20 → 50
28 → 75
40 → 100

## QQQ 20日Realized Volatility

日次Returnの標準偏差 × sqrt(252)

10% → 0
14% → 25
18% → 50
28% → 75
40% → 100

## QQQ 20日Drawdown

20日高値からの下落率を正の数で表す。

0% → 0
3% → 25
6% → 50
10% → 75
16% → 100

## Label

0〜29：Stable / 安定
30〜49：Normal / 通常
50〜69：Volatile / やや不安定
70〜84：Unstable / 不安定
85〜100：Stress / ストレス

Trend ScoreとInstability Scoreは統合しない。

---

# 6. Emergency Market Stress

通常のTrend Stateとは別に、急激な市場ストレスを即時表示する。

以下のいずれかを満たしたらMARKET STRESSバナーを表示する。

1.
Instability Score >= 85

2.
VIX >= 32
かつ
QQQ 5営業日Return <= -6%

3.
QQQが20日高値から12%以上下落

## 効果

- Hysteresisを待たずにMARKET STRESSを即時表示。
- Trend Labelは最大1段階だけ悪化させる。

Strong Bull → Bull
Bull → Neutral
Neutral → Bear
Bear → Strong Bear

- Strong Bull状態は維持しない。
- 上記3条件が3営業日連続ですべてFalseになったらStress解除。
- Raw Trend Score自体は変更しない。

---

# 7. Confidence / 信頼度

目的:
QQQだけが強い狭い上昇と、市場内部まで揃った上昇を区別する。

## Directional Pillars

### Price Trend

QQQ vs 200DMA score
+
QQQ 63日Return score

の平均。

### Breadth

RSP / SPY 63日RS

### Credit

HYG / LQD 63日RS

各Pillar:

60超 → Bull支持
40未満 → Bear支持
40〜60 → Neutral

## Confidence

最終Trend方向と同方向のDirectional Pillar数:

3/3一致 → High
2/3一致 → Medium
0〜1/3一致 → Low

Instability >= 70の場合、Bull RegimeのConfidenceを最大1段階Downgrade可能とする。

Neutral Regimeでは無理にHighを表示しない。

---

# 8. Theme Rotation / テーマローテーション

テーマランキングは2階層に分ける。

1つのランキングにSemiconductorとAI Infrastructureを混ぜない。

---

# 9. Semiconductor Themes / 半導体テーマ

1.
Memory / HBM
メモリ・HBM

2.
NAND / Storage
NAND・ストレージ

3.
GPU / Accelerator
GPU・AIアクセラレータ

4.
Custom ASIC / XPU
カスタムASIC・XPU

5.
Networking
AIネットワーク

6.
Optical / CPO
光通信・CPO

7.
Foundry / Advanced Packaging
ファウンドリ・先端パッケージ

8.
Semi Equipment / Materials
半導体製造装置・材料

---

# 10. AI Infrastructure Themes / AIインフラ

1.
Neo Cloud / AI Cloud
ネオクラウド・AIクラウド

2.
Power
データセンター電力

3.
Cooling / Thermal
冷却・液冷

---

# 11. Theme Basket Rules

- 原則として各テーマ最低4銘柄。
- 時価総額加重は使わない。
- Equal Weight Basketを作る。
- 構成銘柄はコード上でVersion管理する。
- 銘柄追加・削除日を履歴保存する。
- 新規追加銘柄を過去データへ遡及適用しない。
- 構成銘柄が不足するテーマは無理に作らず、統合または保留する。

---

# 12. Theme Strength Score

Score: 0〜100

## Weight

Equal Weight Theme Index 63日Return：35%

Equal Weight Theme Index 21日Return：20%

Breadth
50DMA超え銘柄比率：30%

QQQに対する63日Relative Strength：15%

全テーマの共通比較先はQQQとする。

## Theme Score Label

75〜100：Strong Bull

60〜74：Bull

45〜59：Neutral

30〜44：Bear

0〜29：Strong Bear

---

# 13. Theme Relative Strength

Semiconductor Themesでは、

vs QQQ
+
vs SOXX

を表示する。

AI Infrastructure Themesでは、

vs QQQ
+
vs AI Infrastructure Equal Weight Basket

を表示する。

例:

Memory / HBM
91 / 100
Strong Bull

vs QQQ
+16pt

vs SOXX
+8pt

---

# 14. Theme Momentum / 加速・失速

Theme Scoreの現在値と15営業日前の差を使う。

Delta =
ThemeScore(t)
-
ThemeScore(t-15)

Delta >= +8
→ 急速改善 / Rapidly Improving

+3〜+8
→ 改善 / Improving

-3〜+3
→ 横ばい / Stable

-8〜-3
→ 悪化 / Deteriorating

Delta <= -8
→ 急速悪化 / Rapidly Deteriorating

順位だけではなく、

Score
Label
Momentum

を必ず併記する。

全テーマが弱い場合は、

「現在、強いテーマはありません」

と明示する。

---

# 15. Home Screen v1

表示順:

## MARKET REGIME / 市場レジーム

Regime Label
Trend Score
Confidence
Regime継続営業日

## INSTABILITY / 不安定度

Instability Label
Instability Score

## SEMICONDUCTORS / 半導体

Semiconductor Label
Semiconductor Score
vs QQQ 63D Relative Strength

## SEMICONDUCTOR ROTATION / 半導体テーマ

上位5テーマ

Score
Label
Momentum arrow

を表示。

## AI INFRASTRUCTURE / AIインフラ

Neo Cloud
Power
Cooling

Score
Label
Momentum

を表示。

## AS OF

前営業日の米国市場Close日付

データ更新日時

Market Stress発生時は画面最上部に警告バナーを表示。

---

# 16. Language / 言語

3モード:

日本語

English

日本語 + English

Default:

日本語 + English

専門用語は英語表記を残す。

例:

Market Regime / 市場レジーム

Bull / 強気

Instability / 不安定度

Memory / HBM / メモリ・HBM

Optical / CPO / 光通信・CPO

Neo Cloud / AI Cloud / ネオクラウド・AIクラウド

X投稿生成機能は基本日本語。

---

# 17. Data Storage Requirements

毎営業日以下を保存する。

- date / as_of
- Market Trend Raw Score
- Market各Factor Raw Value
- Market各Factor Score
- Market State Label
- Regime Duration
- Semiconductor Score
- Semiconductor各Factor Raw Value
- Semiconductor各Factor Score
- Instability Score
- Instability各Factor Raw Value
- Instability各Factor Score
- Market Stress Flag
- Confidence Label
- Theme Score全件
- Theme各Factor
- Theme Momentum
- Theme Basket Version
- 使用銘柄一覧
- データ欠損Flag

これにより、後からモデル変更・検証が可能になる。

---

# 18. v1では実装しないもの

- ザラ場Regime判定
- 売買シグナル
- AIによるBull/Bear自動判定
- 15以上の細分化Theme
- Optical Transceiver / CPO / InPの3分割
- EDA / IP独立Theme
- Regime別将来Return統計
- DXY・金利等の追加Macro Factor
- 自動最適化されたWeight / Threshold
- Rolling Z-score正規化

これらはv1を一定期間運用したあと再検討する。

---

# 19. v1.0 Success Criteria

毎日アプリを開いて数秒で以下が分かること。

1.
今はBull / Bearどちら寄りか。

2.
相場は安定しているか、不安定か。

3.
半導体は市場全体より強いか。

4.
半導体の中で現在どのテーマが強いか。

5.
Neo Cloud / Power / Coolingのどこが強いか。

6.
各テーマは改善中か失速中か。

7.
現在の判定にどの程度Confidenceがあるか。

8.
データがいつのClose時点のものか。

---

この仕様を

My Stock OS Regime Model v1.0

として固定する。

実装後は一定期間運用し、データを蓄積してからv1.1以降の変更を検討する。
