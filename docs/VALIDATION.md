# 検証記録

2026-09-09、feature/kabugorilla-v2-phase1。APIの有料呼出しなし。

- Node回帰：9件成功。入金・出金、元本0、配当二重計上、為替、欠落日、訂正、CSV、個人状態保存失敗、実データ29テーマ、表示用エスケープ、各画面、429/timeout/壊れたJSON。
- Python出力保護：6件成功。同日再実行、既知欠損、新規欠損・有効数減、履歴追記・日付後退、実際の隔離プロセス失敗、dry run。
- 凍結8ファイル：元Git blob SHAと完全一致。
- 既存設定検証：29テーマ、104エンティティ、121所属、Home Core重複0、Space規則成功。
- JavaScript9モジュールの構文・相対import、HTML参照アセット、Python構文を確認。

実機Safari操作・視覚検証、本番APIでの再実行、GitHub Pagesへの本番反映は未実施。レビュー用PRのCI結果はGitHub側の表示を参照。
