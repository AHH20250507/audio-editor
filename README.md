# 音频编辑器

一个在浏览器中运行的音频编辑工具，支持上传音频、**视频一键提取音频**、调节音量、裁剪片段、试听和导出 MP3（自动嵌入封面）。

## 在线使用

👉 [https://ahh20250507.github.io/audio-editor/](https://ahh20250507.github.io/audio-editor/)

## 功能

- **视频转音频**：上传 MP4 / WebM / MOV 等视频，一键自动提取音频并载入编辑器
- **音频上传**：支持 MP3 / WAV / OGG / M4A / FLAC 等格式
- **MP3 封面**：导出 MP3 自动嵌入封面图（ID3v2 标签），支持在播放器中显示
- 音量调节：0% ~ 800%
- 音频裁剪：可视化波形拖动选择，支持精确时间输入
- 试听片段：选中后实时试听
- 导出 MP3：一键导出为 192kbps MP3 文件

> 提示：视频音频提取为浏览器端实时渲染，视频越长等待越久，请耐心等待进度提示。

## 本地开发

```
git clone https://github.com/AHH20250507/audio-editor-pro.git
cd audio-editor-pro
# 直接用浏览器打开 index.html 或启动本地 HTTP 服务器
python3 -m http.server 8080
```

## 离线单文件版

`audio-editor.html` 为内联全部依赖的离线单文件版（含封面数据），下载后直接用浏览器打开即可使用。
