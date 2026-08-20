// CDP 端到端测试：上传视频 → 自动提取音频 → 编辑器出现
const http = require('http');

function getWsUrl() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9223/json/list', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const list = JSON.parse(d);
          const page = list.find(t => t.type === 'page');
          resolve(page.webSocketDebuggerUrl);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = {};
  const consoleErrors = [];
  const pageErrors = [];

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending[m.id]) {
      pending[m.id](m.result);
      delete pending[m.id];
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 200));
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0, 200));
    }
  };
  await new Promise(r => ws.onopen = r);

  const send = (method, params) => new Promise((res) => {
    const i = ++id;
    pending[i] = res;
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result ? r.result.value : undefined;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:8322/audio-editor.html' });
  await sleep(3000);

  console.log('✓ 页面加载完成, readyState:', await evalJS('document.readyState'));
  console.log('✓ MP4Box 全局:', await evalJS('typeof MP4Box'));
  console.log('✓ lamejs 全局:', await evalJS('typeof lamejs'));
  console.log('✓ 上传区可见:', await evalJS("!document.getElementById('uploadZone').classList.contains('hidden')"));

  // 上传视频
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  await send('DOM.setFileInputFiles', {
    nodeId: q.nodeId,
    files: ['C:/Users/EDY/WorkBuddy/2026-08-20-09-42-53/audio-editor-pro/test_video.mp4'],
  });
  console.log('✓ 已上传 test_video.mp4，等待提取...');

  // 轮询编辑器出现（最长 40s）
  let editorShown = false;
  for (let i = 0; i < 40; i++) {
    editorShown = await evalJS("!document.getElementById('editor').classList.contains('hidden')");
    if (editorShown) break;
    await sleep(1000);
  }

  if (editorShown) {
    await sleep(2000); // 等波形渲染
    console.log('✓ 编辑器已显示');
    console.log('✓ 文件名:', await evalJS("document.getElementById('fileName').textContent"));
    console.log('✓ 音频时长:', await evalJS("document.getElementById('durationDisplay').textContent"));
    console.log('✓ 封面缩略图显示:', await evalJS("!document.getElementById('coverThumb').classList.contains('hidden')"));
  } else {
    console.log('✗ 编辑器未出现');
    console.log('  loadingText:', await evalJS("document.getElementById('loadingText').textContent"));
    console.log('  toast:', await evalJS("document.getElementById('toast').textContent"));
    console.log('  uploadZone 状态:', await evalJS("document.getElementById('uploadZone').className"));
  }

  console.log('=== console 错误 ===');
  consoleErrors.length ? consoleErrors.forEach(e => console.log(' -', e)) : console.log(' (无)');
  console.log('=== 页面异常 ===');
  pageErrors.length ? pageErrors.forEach(e => console.log(' -', e)) : console.log(' (无)');

  ws.close();
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
