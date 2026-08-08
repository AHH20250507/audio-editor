# 音频编辑器

一个在浏览器中运行的音频编辑工具，支持上传音频、调节音量、裁剪片段、试听和导出 MP3。

## 在线使用

👉 [https://ahh20250507.github.io/audio-editor/](https://ahh20250507.github.io/audio-editor/)

## 功能

- 音频上传：支持 MP3 / WAV / OGG / M4A / FLAC 等格式
- 音量调节：0% ~ 800%
- 音频裁剪：可视化波形拖动选择，支持精确时间输入
- 试听片段：选中后实时试听
- 导出 MP3：一键导出为 192kbps MP3 文件

## 本地开发

```
git clone https://github.com/AHH20250507/audio-editor-pro.git
cd audio-editor-pro
# 直接用浏览器打开 index.html 或启动本地 HTTP 服务器
python3 -m http.server 8080
```