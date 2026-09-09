# ホーム画面起動と銘柄候補選択

## アプリ表示
- `manifest.webmanifest`: 相対パスのscope/start_url、standalone、名称「株ゴリラ🦍」。GitHub Pagesのサブパスにも対応。
- Apple用metaと180pxアイコン、192/512pxのアプリアイコン。既存の株価棒グラフの線アイコンを基にしたネイビー/青のマーク。
- ヘッダー・下部ナビ固定、上下左右safe-area、画面幅いっぱい。通常Safariとstandalone双方を考慮。
- Service Workerやオフラインキャッシュは追加しない。既存個人保存キーは維持。

## 銘柄マスター
初回はGitHub ActionsでTwelve Data `/stocks?country=United%20States`を取得。2026-09-09の取得結果は20,361市場別レコード。NVDA（NVIDIA Corporation / NASDAQ）と、テーマ構成外AAPL（Apple Inc. / NASDAQ）を含む。今回は米国市場対象。世界全市場対応とはしない。

ブラウザは同じoriginの `data/symbols.json` のみ検索し、Twelve DataのAPIキーや認証ヘッダーを受け取らない。キーはGitHub SecretsをActionsの環境変数としてだけ使用。 `/symbol_search` は対話型サーバーが必要になるため、今回の静的サイトでは採用しない。

新規ワークフロー `symbols.yml` のみ追加。既存更新ワークフロー、凍結テーマ構成・計算は不変。日次スケジュールは21:17 UTC（翌06:17 JST）。GitHubの定期実行はdefault branch対象のため、mainへ未マージの現在はPR用の初回実行のみ。マージ後に日次実行が有効になる。手動実行にも対応。

原則1日1リクエスト、429/一時エラー時のみ最大4回まで。timeout、APIエラー、件数急減、NVDAを含まない不完全結果では既存マスターを上書きしない。正常結果を一時ファイルに書いてから置換。キーを含むURL・例外をログへ出さない。価格データを取得できるプランかどうかと、銘柄一覧に存在することは別。

## 登録
- 空白除去・大文字化→会社名/ティッカー検索→市場付き候補選択→保存。
- ティッカーだけの自由入力では保存不可。候補IDと正規化ティッカーを保存直前にマスター照合。
- 監視・新規保有は同じティッカーの重複を拒否。既存保有の編集と新規登録を区別。
- 保有、配当、ニュースの関連銘柄で同じ検索部品とマスターを共有。ニュースは複数候補を選択・取り消しできる。
- 市場選択情報は端末の `securities` に保存。ティッカー文字列を利用する凍結計算と互換性を維持。同じティッカーに別市場を重ねて登録・上書きしない。
- 旧保存データは自動削除しない。新規バックアップ取込銘柄も検証し、旧記録の復元と新規追加を区別。
- マスター取得失敗時は新規登録を停止し、既存の記録閲覧や削除は維持。設定の再読み込みで再取得。

## テスト
Node 34件、Python 9件、Frozen 8ファイル、config validation成功。NVDA / nvda / 前後空白 / NVDAAAA拒否 / 重複拒否 / AAPL登録 / 市場候補選択 / 共通フォーム / マスター取得失敗 / 更新失敗時保護 / PNGサイズとmanifestを確認。

## iPhone確認
同じプレビューをSafariで再読み込み→共有→ホーム画面に追加→名称「株ゴリラ🦍」→追加。追加したアイコンから起動し、固定ヘッダー・ホームバー・キーボード表示時の保存ボタンを確認。以前のショートカットで表示が変わらなければ新しく追加して確認（Safariの保存データは消さない）。実機standalone起動はユーザー確認待ち。

銘柄画面でNVD入力→候補NVDA/NVIDIA Corporation/NASDAQを選択→追加。続けて同じNVDA追加が拒否されること、NVDAAAAが見つからないこと、AAPLが候補選択で追加できることを確認。保有・配当・ニュースにも同じ検索がある。

## 参照
- https://twelvedata.com/docs （stocks / symbol_search）
- https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html

main未マージ。Forward Engine / Shadow Modeは引き続き未実装・停止。
