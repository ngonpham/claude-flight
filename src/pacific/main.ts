/**
 * Entry point of "Pacific 1942" — Bắn Máy Bay, the ten-battle arcade shooter of the Pacific War
 * (pacific.html). Checks for WebGL before loading the game code, then starts the app; a browser
 * without WebGL, or a failure while starting, ends on a short message instead of a blank page.
 */
function message(text: string): void {
  const p = document.createElement('p');
  p.style.cssText = 'position:fixed;inset:0;margin:0;display:flex;align-items:center;justify-content:center;padding:16px;color:#efe6cf;font:600 18px system-ui,Arial,sans-serif;text-align:center';
  p.textContent = text;
  document.body.append(p);
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) return;
  if (!hasWebGL()) {
    message('Trình duyệt này không hỗ trợ WebGL nên không chạy được trò chơi. Hãy thử Chrome, Edge, Firefox hoặc Safari bản mới.');
    return;
  }
  try {
    const { PacificApp } = await import('./app');
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    new PacificApp(container, { search: location.search, storage, touch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window });
  } catch (e) {
    console.error('Pacific 1942 failed to start', e);
    message('Không khởi động được trò chơi. Hãy tải lại trang.');
  }
}

void main();
