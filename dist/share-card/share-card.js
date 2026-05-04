// share-card.js — Independent ES module for memex share cards
// Zero dependencies. markdownRenderer and html2canvas are injected/lazy-loaded.

const themes = {
  clean: {
    name: 'Clean', isDark: false,
    background: '#ffffff',
    text: '#1d1d1f',
    secondary: '#666666',
    accent: '#007aff',
    chipBg: 'rgba(0,122,255,0.08)',
    chipText: '#007aff',
    border: 'rgba(0,0,0,0.08)',
    brand: '#999999',
    contentBg: '#ffffff',
    codeBg: 'rgba(0,0,0,0.04)',
    thBg: 'rgba(0,0,0,0.03)',
  },
  aurora: {
    name: 'Aurora', isDark: false,
    background: 'radial-gradient(138% 32% at 70% 33%, #fff 2%, rgba(255,160,247,0.3) 50%, rgba(212,245,255,0.5)), #fff',
    text: '#1d1d1f',
    secondary: '#666666',
    accent: '#007aff',
    chipBg: 'rgba(0,122,255,0.08)',
    chipText: '#007aff',
    border: 'rgba(0,0,0,0.06)',
    brand: '#999999',
    contentBg: 'transparent',
    codeBg: 'rgba(0,0,0,0.04)',
    thBg: 'rgba(0,0,0,0.03)',
  },
  spectrum: {
    name: 'Spectrum', isDark: true,
    background: 'linear-gradient(145deg, #c676ff 0%, #654cff 41%, #405eff 75%, #007fff 99%)',
    text: '#ffffff',
    secondary: 'rgba(255,255,255,0.7)',
    accent: '#a0d4ff',
    chipBg: 'rgba(255,255,255,0.15)',
    chipText: 'rgba(255,255,255,0.9)',
    border: 'rgba(255,255,255,0.15)',
    brand: 'rgba(255,255,255,0.4)',
    contentBg: 'rgba(0,0,0,0.15)',
    codeBg: 'rgba(255,255,255,0.1)',
    thBg: 'rgba(255,255,255,0.08)',
  },
  ocean: {
    name: 'Ocean', isDark: true,
    background: '#235ff5',
    text: '#ffffff',
    secondary: 'rgba(255,255,255,0.7)',
    accent: '#a0d4ff',
    chipBg: 'rgba(255,255,255,0.15)',
    chipText: 'rgba(255,255,255,0.9)',
    border: 'rgba(255,255,255,0.15)',
    brand: 'rgba(255,255,255,0.4)',
    contentBg: 'rgba(0,0,0,0.1)',
    codeBg: 'rgba(255,255,255,0.1)',
    thBg: 'rgba(255,255,255,0.08)',
  },
  midnight: {
    name: 'Midnight', isDark: true,
    background: '#1c1c1e',
    text: 'rgba(255,255,255,0.9)',
    secondary: 'rgba(255,255,255,0.55)',
    accent: '#5ac8fa',
    chipBg: 'rgba(90,200,250,0.12)',
    chipText: '#5ac8fa',
    border: 'rgba(255,255,255,0.1)',
    brand: 'rgba(255,255,255,0.25)',
    contentBg: 'rgba(255,255,255,0.05)',
    codeBg: 'rgba(255,255,255,0.08)',
    thBg: 'rgba(255,255,255,0.06)',
  },
  frost: {
    name: 'Frost', isDark: false,
    background: '#e7f1fa',
    text: '#1d1d1f',
    secondary: '#5a7a9a',
    accent: '#007aff',
    chipBg: 'rgba(0,122,255,0.08)',
    chipText: '#007aff',
    border: 'rgba(17,31,44,0.08)',
    brand: '#8aa0b8',
    contentBg: 'rgba(255,255,255,0.85)',
    codeBg: 'rgba(0,0,0,0.04)',
    thBg: 'rgba(0,0,0,0.03)',
  },
};

const STYLES = `
.memex-sc-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
.memex-sc-picker { display: flex; gap: 8px; margin-top: 16px; justify-content: center; }
.memex-sc-thumb-wrap { display: flex; flex-direction: column; align-items: center; gap: 4px; cursor: pointer; }
.memex-sc-thumb {
  width: 48px; height: 36px; border-radius: 6px; padding: 5px; cursor: pointer;
  border: 2px solid transparent; transition: border-color 0.15s, transform 0.15s;
  display: flex; flex-direction: column; gap: 2px; box-sizing: border-box;
}
.memex-sc-thumb:hover { transform: scale(1.08); }
.memex-sc-thumb.active { border-color: #007aff; }
.memex-sc-thumb-label { font-size: 9px; color: rgba(255,255,255,0.5); font-weight: 500; text-align: center; }
.memex-sc-skel { border-radius: 1px; }
.memex-sc-card {
  max-width: 420px; width: 100%; border-radius: 16px; overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12);
}
.memex-sc-card-inner { padding: 30px; overflow-wrap: break-word; word-break: break-word; }
.memex-sc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.memex-sc-source {
  font-size: 10px; font-weight: 600; letter-spacing: 0.5px;
  padding: 3px 10px; border-radius: 10px;
}
.memex-sc-date { font-size: 12px; }
.memex-sc-title { font-size: 18px; font-weight: 700; margin-bottom: 12px; line-height: 1.4; }
.memex-sc-body {
  font-size: 14px; line-height: 1.7; margin-bottom: 16px; border-radius: 8px; padding: 12px;
  overflow-wrap: break-word; word-break: break-word;
}
.memex-sc-body p { margin-bottom: 8px; }
.memex-sc-body p:last-child { margin-bottom: 0; }
.memex-sc-body pre { padding: 8px 12px; border-radius: 6px; overflow-x: auto; font-size: 12px; margin: 8px 0; background: var(--sc-code-bg); }
.memex-sc-body code { font-size: 12px; padding: 1px 5px; border-radius: 3px; background: var(--sc-code-bg); overflow-wrap: break-word; }
.memex-sc-body pre code { padding: 0; background: none; }
.memex-sc-body table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
.memex-sc-body th, .memex-sc-body td { padding: 6px 10px; text-align: left; border: 1px solid var(--sc-table-border); }
.memex-sc-body th { font-weight: 600; background: var(--sc-th-bg); }
.memex-sc-body img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
.memex-sc-body ul, .memex-sc-body ol { padding-left: 20px; margin: 8px 0; }
.memex-sc-body li { margin-bottom: 4px; }
.memex-sc-body blockquote { margin: 8px 0; padding: 4px 12px; border-left: 3px solid var(--sc-accent); }
.memex-sc-body h1, .memex-sc-body h2, .memex-sc-body h3 { margin: 12px 0 6px; font-weight: 600; }
.memex-sc-body h1 { font-size: 18px; }
.memex-sc-body h2 { font-size: 16px; }
.memex-sc-body h3 { font-size: 14px; }
.memex-sc-body hr { border: none; border-top: 1px solid var(--sc-table-border); margin: 12px 0; }
.memex-sc-links { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.memex-sc-chip { font-size: 11px; padding: 3px 10px; border-radius: 11px; }
.memex-sc-divider { height: 1px; margin-bottom: 16px; }
.memex-sc-footer { display: flex; justify-content: space-between; align-items: center; }
.memex-sc-stats { font-size: 10px; letter-spacing: 1px; }
.memex-sc-brand { font-size: 11px; font-weight: 600; }
.memex-sc-actions { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }
.memex-sc-btn {
  padding: 8px 20px; border: none; border-radius: 8px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.memex-sc-btn.primary { background: #007aff; color: #fff; }
.memex-sc-btn.primary:hover { background: #0066d6; }
.memex-sc-btn.secondary { background: rgba(0,0,0,0.06); color: #666; }
.memex-sc-btn.secondary:hover { background: rgba(0,0,0,0.1); }
`;

let html2canvasPromise = null;

function lazyLoadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (html2canvasPromise) return html2canvasPromise;
  html2canvasPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1/dist/html2canvas.min.js';
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('Failed to load html2canvas'));
    document.head.appendChild(s);
  });
  return html2canvasPromise;
}

function buildSkeleton(t) {
  const barColor = t.isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.12)';
  return `
    <div class="memex-sc-skel" style="width:50%;height:3px;background:${barColor};margin-bottom:3px"></div>
    <div class="memex-sc-skel" style="width:100%;height:2px;background:${barColor};margin-bottom:2px"></div>
    <div class="memex-sc-skel" style="width:80%;height:2px;background:${barColor}"></div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createShareCard(container, options = {}) {
  const {
    data = {},
    theme: initialTheme = 'aurora',
    markdownRenderer = (text) => text,
    onExport = null,
    onCancel = null,
  } = options;

  let currentTheme = initialTheme;
  let currentData = { ...data };

  // Inject styles once
  if (!document.getElementById('memex-sc-styles')) {
    const style = document.createElement('style');
    style.id = 'memex-sc-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // Build picker
  let pickerHtml = '<div class="memex-sc-picker">';
  for (const [key, t] of Object.entries(themes)) {
    const needsBorder = !t.isDark && !t.background.includes('gradient');
    const borderStyle = needsBorder ? 'border:1px solid rgba(0,0,0,0.1);' : '';
    pickerHtml += `<div class="memex-sc-thumb-wrap" data-theme="${key}"><div class="memex-sc-thumb${key === currentTheme ? ' active' : ''}" data-theme="${key}" style="background:${t.background};${borderStyle}">${buildSkeleton(t)}</div><span class="memex-sc-thumb-label">${t.name}</span></div>`;
  }
  pickerHtml += '</div>';

  function renderCard() {
    const t = themes[currentTheme];
    const bodyHtml = markdownRenderer(currentData.body || '');
    const dateStr = currentData.created ? currentData.created.slice(0, 10).replace(/-/g, '/') : '';
    const src = (currentData.source || 'note').toUpperCase();
    const links = (currentData.links || [])
      .map(l => `<span class="memex-sc-chip" style="background:${t.chipBg};color:${t.chipText}">[[${escapeHtml(l)}]]</span>`)
      .join('');
    const stats = currentData.stats
      ? `${currentData.stats.totalCards || 0} CARDS \u00b7 ${currentData.stats.totalDays || 0} DAYS`
      : '';

    return `
      <div class="memex-sc-card" style="background:${t.background}">
        <div class="memex-sc-card-inner">
          <div class="memex-sc-header">
            <span class="memex-sc-source" style="background:${t.chipBg};color:${t.chipText}">${escapeHtml(src)}</span>
            <span class="memex-sc-date" style="color:${t.secondary}">${dateStr}</span>
          </div>
          <div class="memex-sc-title" style="color:${t.text}">${escapeHtml(currentData.title || currentData.slug || '')}</div>
          <div class="memex-sc-body" style="color:${t.secondary};background:${t.contentBg};
            --sc-code-bg:${t.codeBg};--sc-table-border:${t.border};--sc-th-bg:${t.thBg};--sc-accent:${t.accent}">
            ${bodyHtml}
          </div>
          ${links ? `<div class="memex-sc-links">${links}</div>` : ''}
          <div class="memex-sc-divider" style="background:${t.border}"></div>
          <div class="memex-sc-footer">
            <span class="memex-sc-stats" style="color:${t.brand}">${stats}</span>
            <span class="memex-sc-brand" style="color:${t.brand}">memex</span>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    const cardHtml = renderCard();
    const actionsHtml = `<div class="memex-sc-actions">
      ${onCancel ? '<button class="memex-sc-btn secondary" data-action="cancel">Cancel</button>' : ''}
      <button class="memex-sc-btn primary" data-action="export">Download</button>
    </div>`;
    // innerHTML is required here to render the card DOM structure from HTML strings.
    // User-supplied text (title, source, links) is escaped via escapeHtml() before interpolation.
    container.innerHTML = `<div class="memex-sc-root">${cardHtml}${pickerHtml}${actionsHtml}</div>`;
    bindEvents();
  }

  function bindEvents() {
    container.querySelectorAll('.memex-sc-thumb-wrap').forEach(wrap => {
      wrap.addEventListener('click', () => {
        currentTheme = wrap.dataset.theme;
        container.querySelectorAll('.memex-sc-thumb').forEach(t => t.classList.remove('active'));
        wrap.querySelector('.memex-sc-thumb').classList.add('active');
        const cardEl = container.querySelector('.memex-sc-card');
        const tempDiv = document.createElement('div');
        // innerHTML is required here to parse the card HTML into a DOM element for replaceWith().
        // All user-supplied text is escaped via escapeHtml() in renderCard().
        tempDiv.innerHTML = renderCard();
        cardEl.replaceWith(tempDiv.firstElementChild);
      });
    });
    container.querySelector('[data-action="export"]')?.addEventListener('click', () => exportPng());
    container.querySelector('[data-action="cancel"]')?.addEventListener('click', () => { if (onCancel) onCancel(); });
  }

  async function exportPng() {
    const cardEl = container.querySelector('.memex-sc-card');
    if (!cardEl) return;
    // Fix width for consistent export size
    const origWidth = cardEl.style.width;
    cardEl.style.width = '420px';
    const h2c = await lazyLoadHtml2Canvas();
    const canvas = await h2c(cardEl, { scale: 2, useCORS: true, backgroundColor: null });
    cardEl.style.width = origWidth;
    canvas.toBlob(blob => {
      if (onExport) {
        onExport(blob, (currentData.slug || 'memex-card') + '.png');
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (currentData.slug || 'memex-card') + '.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  }

  render();

  return {
    setTheme(name) {
      if (!themes[name]) return;
      currentTheme = name;
      render();
    },
    setData(newData) {
      currentData = { ...newData };
      render();
    },
    export: exportPng,
    destroy() {
      container.textContent = '';
    },
  };
}
