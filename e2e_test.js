const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.goto('http://localhost:8322/audio-editor.html', { waitUntil: 'networkidle' });
  console.log('✓ 页面加载，MP4Box 全局:', await page.evaluate(() => typeof MP4Box));
  console.log('✓ lamejs 全局:', await page.evaluate(() => typeof lamejs));

  // 上传视频
  await page.setInputFiles('#fileInput', 'test_video.mp4');
  console.log('✓ 已上传 test_video.mp4');

  // 等待编辑器出现（最长 30s）
  try {
    await page.waitForSelector('#editor:not(.hidden)', { timeout: 30000 });
    console.log('✓ 编辑器已显示');
    const name = await page.textContent('#fileName');
    console.log('✓ 文件名:', name.trim());
    const loadingHidden = await page.evaluate(() => document.getElementById('loadingZone').classList.contains('hidden'));
    console.log('✓ loading 已隐藏:', loadingHidden);
    // 等波形 ready
    await page.waitForTimeout(1500);
    const dur = await page.evaluate(() => document.getElementById('durationDisplay').textContent);
    console.log('✓ 音频时长:', dur);
  } catch (e) {
    console.log('✗ 编辑器未出现:', e.message);
    const loadingText = await page.evaluate(() => document.getElementById('loadingText').textContent);
    const toast = await page.evaluate(() => document.getElementById('toast').textContent);
    console.log('  loadingText:', loadingText);
    console.log('  toast:', toast);
  }

  console.log('=== console 错误 ===');
  errors.forEach(e => console.log(' -', e.slice(0, 200)));
  if (errors.length === 0) console.log(' (无)');
  await browser.close();
})();
