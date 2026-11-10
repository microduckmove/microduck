# Microduck 模擬場

使用方向鍵、WASD 或畫面方向按鈕讓 Microduck 前進、後退和轉向。按 R 可切換坐下與站起，C 切換跟隨視角，空白鍵重置。拖曳可轉視角，雙指或滾輪可縮放。

## 發布到 GitHub Pages

1. 在 GitHub 建立公開儲存庫，例如 `microduck`。
2. 把此資料夾內的檔案上傳到 `main` 分支根目錄。確認 `index.html`、`app.js`、`style.css`、`assets/`、`vendor/` 都在根目錄，並保留 `.nojekyll`。
3. 到 **Settings → Pages → Build and deployment**，選 **Deploy from a branch → main → / (root) → Save**。
4. 等 Pages 顯示 **Visit site**，開啟並複製正式網址。

網站是靜態 HTML、CSS 和 JavaScript，可直接由 GitHub Pages 提供。瀏覽器需要 WebGL 2。模型、關節資料和 Three.js 都隨頁面一起部署。

## 放進官網

開啟交付的 `Microduck_官網嵌入_單行.html`，把兩處 `https://YOUR-USERNAME.github.io/microduck/` 都換成 Pages 的正式網址。把整行 HTML 貼進官網的 HTML 欄位。存檔後用手機開啟實際課程頁，檢查 iframe 和動作按鈕。若編輯器移除 iframe，可只貼同一行裡的外連 `<a>`，讓訪客在新視窗操作。

## 本機預覽

若電腦已裝 Python 3，在此資料夾開啟終端機，執行 `python -m http.server 8000 --bind 127.0.0.1`，再開啟 `http://127.0.0.1:8000/`。請透過 HTTP 開啟，讓瀏覽器可以載入模型和 JavaScript 模組。

模型與關節資料來自 [Pollen Robotics 的 Microduck Simulator](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/tree/efedf47)，來源版本為 `efedf47`，授權見 `assets/POLLEN-LICENSE.txt`。本頁使用自行編寫的動作動畫。Three.js 0.180.0 的授權見 `vendor/LICENSE`。
