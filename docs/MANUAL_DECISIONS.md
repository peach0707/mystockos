# 手動判断の固定enum（v1）

保有・監視判断はユーザーが選択する記録です。アプリによる推奨ではありません。Forward Engine / Shadow Modeは未実装のままです。

|保有enum|表示|
|---|---|
|unset|未選択|
|hold|保有継続|
|add_review|買い増し検討|
|wait_pullback|押し目待ち|
|reduce_review|一部売却検討|
|exit_review|売却検討|
|review|判断を見直す|

|監視enum|表示|
|---|---|
|unset|未選択|
|watching|監視中|
|wait_pullback|押し目待ち|
|wait_breakout|上抜け待ち|
|wait_results|決算待ち|
|entry_review|購入検討|
|avoid|見送り|

表示・選択肢・検証は `assets/js/decisions.js` を共通で使用します。定義済みenumの意味は変更・再利用しません。表示名の変更でも保存値は維持します。未知のenumや別用途のenumは保存・バックアップ読込時に拒否します。

個人データは localStorage `mystockos.private.v6` のみに保存します（投資根拠タグ追加後）。判断enumのバージョンは1のままです。
- `holdings[].decision`: 保有enum
- `watchDecisions[ticker]`: 監視enum（未設定はunset）
- `decisionSchemaVersion`: 1
- `decisionHistory[]`: id / recorded_at（端末のUTC時刻）/ ticker / scope（held、watch）/ value（enum）/ source（manual）/ enum_version（1）

選択を変更したときだけ履歴へ追記します。同じ値での再保存は重複しません。保有と監視の両方に登録した銘柄も独立した判断を保存し、詳細画面で両方を編集できます。履歴は削除済み銘柄についても残します。JSONバックアップに含まれます。端末内の履歴であり、端末時刻の正確性・改ざん耐性は保証しません。

将来のモデル比較ではscope・enum_versionと時点を照合します。これは手動判断履歴の保存のみであり、Forwardの予測や自動採点、本番売買判断への接続は追加していません。

## 旧データ移行
v2は既存の金融台帳移行を通し、v3からv4へ移行します。v3の保有判断は日本語表示と完全一致する場合だけenumへ変換します。不一致はunsetとし、元の文言は `legacyDecision` に残します。旧投資根拠・買い条件・watchNotesは自由入力フォームや詳細表示には出さず、バックアップ用に保持します。買い条件の文章から監視判断を推測しません。過去判断の時刻を捏造しないため移行だけでは判断履歴を生成しません。

旧localStorageキーは変更しません。新形式の検証・保存成功後に切り替えます。容量不足や不正なデータで移行できない場合は元データを保持して編集を停止します。
