@echo off
REM 環境変数を書き換える場合は .env ファイルを編集してください

REM 英語パスの作業ディレクトリに移動
cd /d C:\VCproject

REM ウィンドウタイトルを明示的に指定して起動
start "receiver" cmd /k node vc_j.js
start "sender" cmd /k node vc_s.js
