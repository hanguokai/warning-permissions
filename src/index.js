const TabSize = 2;
let MultipleHostWarning; // "Read and change your data on a number of websites"

// Presets collection
const PRESETS = {
  'mv3-basic': {
    name: "My Modern Extension",
    version: "1.0.0",
    manifest_version: 3,
    description: "A modern Manifest V3 browser extension",
    permissions: ["storage", "alarms"],
    host_permissions: ["https://api.example.com/*"]
  },
  'mv3-content-script': {
    name: "Content Injector Extension",
    version: "2.1.0",
    manifest_version: 3,
    permissions: ["storage", "activeTab", "scripting"],
    host_permissions: ["https://*.google.com/*", "https://*.github.com/*"],
    content_scripts: [
      {
        matches: ["https://*.google.com/*", "<all_urls>"],
        js: ["content.js"]
      }
    ]
  },
  'mv3-declarative-net': {
    name: "Ad & Request Blocker",
    version: "1.2.0",
    manifest_version: 3,
    permissions: ["declarativeNetRequest", "declarativeNetRequestWithHostAccess"],
    host_permissions: ["<all_urls>"]
  },
  'mv2-legacy': {
    name: "Legacy MV2 Extension",
    version: "0.9.0",
    manifest_version: 2,
    permissions: ["tabs", "bookmarks", "history", "http://*/*", "https://*/*"],
    background: {
      scripts: ["background.js"],
      persistent: true
    }
  },
  'empty': {
    manifest_version: 3,
    name: "New Extension",
    version: "1.0.0"
  }
};

// Debounce helper
const delayExec = (function () {
  const timer = {};
  return function (callback, ms, type) {
    clearTimeout(timer[type] || 0);
    timer[type] = setTimeout(callback, ms);
  };
})();

// HTML escape helper
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Lightweight JSON Syntax Highlighter
 */
function highlightJSON(code) {
  if (!code) return '';
  const escaped = escapeHtml(code);
  
  // Match strings, numbers, booleans, null, keys, and punctuation
  const jsonTokenRegex = /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}::\[\],])/g;
  
  return escaped.replace(jsonTokenRegex, (match) => {
    let cls = 'token-punctuation';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        // JSON Key
        const keyText = match.slice(0, -1);
        return `<span class="token-key">${keyText}</span><span class="token-punctuation">:</span>`;
      } else {
        // String value
        cls = 'token-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'token-boolean';
    } else if (/null/.test(match)) {
      cls = 'token-null';
    } else if (/-?\d+/.test(match)) {
      cls = 'token-number';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

/**
 * Parses JSON Error to extract line number
 */
function parseJsonError(code, err) {
  let line = null;
  let column = null;

  // Modern Chrome parsing error format: "at line X column Y" or "at position Z"
  const lineColMatch = err.message.match(/line (\d+) column (\d+)/i);
  if (lineColMatch) {
    line = parseInt(lineColMatch[1], 10);
    column = parseInt(lineColMatch[2], 10);
  } else {
    const posMatch = err.message.match(/position (\d+)/i);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const linesBefore = code.slice(0, pos).split('\n');
      line = linesBefore.length;
      column = linesBefore[linesBefore.length - 1].length + 1;
    }
  }

  return { line, column, message: err.message };
}

/**
 * IDE Code Editor Component
 */
class CodeEditor {
  constructor(container, options = {}) {
    this.container = container;
    this.onChange = options.onChange || (() => {});
    
    this.gutter = container.querySelector('.editor-gutter');
    this.highlightPre = container.querySelector('.code-highlight code');
    this.textarea = container.querySelector('.code-input');
    this.statusPill = container.querySelector('.json-status-pill');
    this.errorBanner = container.querySelector('.error-banner');
    this.presetSelect = container.querySelector('.preset-select');
    this.btnFormat = container.querySelector('.btn-format');
    this.btnCopy = container.querySelector('.btn-copy');
    this.btnUpload = container.querySelector('.file-input');

    this.errorLine = null;

    this.bindEvents();
  }

  bindEvents() {
    this.textarea.addEventListener('input', () => {
      this.updateHighlightAndGutter();
      this.onChange(this.getValue());
    });

    this.textarea.addEventListener('scroll', () => {
      this.highlightPre.parentElement.scrollTop = this.textarea.scrollTop;
      this.highlightPre.parentElement.scrollLeft = this.textarea.scrollLeft;
      this.gutter.scrollTop = this.textarea.scrollTop;
    });

    this.textarea.addEventListener('keydown', (e) => this.handleKeyDown(e));

    if (this.presetSelect) {
      this.presetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (PRESETS[val]) {
          this.setValue(JSON.stringify(PRESETS[val], null, TabSize));
          e.target.value = ''; // reset dropdown
        }
      });
    }

    if (this.btnFormat) {
      this.btnFormat.addEventListener('click', () => this.format());
    }

    if (this.btnCopy) {
      this.btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(this.getValue()).then(() => {
          const originalText = this.btnCopy.textContent;
          this.btnCopy.textContent = 'Copied!';
          setTimeout(() => { this.btnCopy.textContent = originalText; }, 1500);
        });
      });
    }

    if (this.btnUpload) {
      this.btnUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            this.setValue(evt.target.result);
          };
          reader.readAsText(file);
        }
      });
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = this.textarea.selectionStart;
      const end = this.textarea.selectionEnd;
      const val = this.textarea.value;

      if (e.shiftKey) {
        // Shift+Tab: unindent
        const before = val.substring(0, start);
        const lineStart = before.lastIndexOf('\n') + 1;
        const currentLine = val.substring(lineStart, end);
        if (currentLine.startsWith(' '.repeat(TabSize))) {
          this.textarea.value = val.substring(0, lineStart) + currentLine.substring(TabSize);
          this.textarea.selectionStart = this.textarea.selectionEnd = Math.max(lineStart, start - TabSize);
        }
      } else {
        // Tab: insert spaces
        const spaces = ' '.repeat(TabSize);
        this.textarea.value = val.substring(0, start) + spaces + val.substring(end);
        this.textarea.selectionStart = this.textarea.selectionEnd = start + TabSize;
      }

      this.updateHighlightAndGutter();
      this.onChange(this.getValue());
    } else if (e.key === 'F' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault();
      this.format();
    }
  }

  getValue() {
    return this.textarea.value;
  }

  setValue(str) {
    this.textarea.value = str;
    this.updateHighlightAndGutter();
    this.onChange(this.getValue());
  }

  format() {
    try {
      const obj = JSON.parse(this.getValue());
      this.setValue(JSON.stringify(obj, null, TabSize));
    } catch (e) {
      // cannot format invalid JSON
    }
  }

  updateHighlightAndGutter() {
    const code = this.getValue();
    const lines = code.split('\n');
    
    // Gutter line numbers
    let gutterHtml = '';
    for (let i = 1; i <= lines.length; i++) {
      const isErr = this.errorLine === i;
      gutterHtml += `<div class="gutter-num ${isErr ? 'error-line' : ''}">${i}</div>`;
    }
    this.gutter.innerHTML = gutterHtml;

    // Syntax Highlight
    try {
      JSON.parse(code);
      this.highlightPre.innerHTML = highlightJSON(code) + '\n';
      this.setStatus(true);
      this.errorLine = null;
    } catch (err) {
      const errInfo = parseJsonError(code, err);
      this.errorLine = errInfo.line;
      this.highlightPre.innerHTML = highlightJSON(code) + '\n';
      this.setStatus(false, errInfo);
    }
  }

  setStatus(isValid, errInfo = null) {
    if (isValid) {
      this.statusPill.textContent = 'JSON Valid';
      this.statusPill.className = 'json-status-pill valid';
      this.errorBanner.classList.add('hidden');
      this.errorBanner.textContent = '';
    } else {
      this.statusPill.textContent = 'JSON Invalid';
      this.statusPill.className = 'json-status-pill invalid';
      this.errorBanner.classList.remove('hidden');
      const lineMsg = errInfo && errInfo.line ? ` (Line ${errInfo.line}, Col ${errInfo.column})` : '';
      this.errorBanner.textContent = `Syntax Error${lineMsg}: ${errInfo ? errInfo.message : 'Invalid JSON'}`;
    }
  }
}

/**
 * Single Workspace Side Pane Controller
 */
class PermissionTest {
  constructor(containerId) {
    this.id = containerId;
    const template = document.getElementById("workspace");
    const clone = document.importNode(template.content, true);

    this.outputTitle = clone.querySelector('.output-title');
    this.summaryBadges = clone.querySelector('.diff-summary-badges');
    this.warningList = clone.querySelector('.warning-list');
    
    document.getElementById(containerId).appendChild(clone);
    this.container = document.getElementById(containerId);

    this.editor = new CodeEditor(this.container, {
      onChange: (val) => delayExec(() => this.updateOutput(val), 300, this.id + "-update")
    });

    this.setExampleManifest();
  }

  setExampleManifest() {
    const preset = this.id === 'left-sidebar' ? PRESETS['mv3-basic'] : PRESETS['mv3-content-script'];
    this.editor.setValue(JSON.stringify(preset, null, TabSize));
  }

  async updateOutput(manifestStr) {
    try {
      let result = [];
      if (typeof chrome !== 'undefined' && chrome.management && chrome.management.getPermissionWarningsByManifest) {
        result = await chrome.management.getPermissionWarningsByManifest(manifestStr);
      } else {
        // Fallback simulation for non-extension preview environment
        result = this.simulatePermissionWarnings(manifestStr);
      }
      
      result.sort();
      this.result = result;
      this.isValidJson = true;
    } catch (e) {
      this.result = undefined;
      this.isValidJson = false;
    }
    Manager.showDiff();
  }

  // Simulation fallback if run outside extension runtime context
  simulatePermissionWarnings(manifestStr) {
    try {
      const obj = JSON.parse(manifestStr);
      const warnings = [];
      const perms = obj.permissions || [];
      const hosts = obj.host_permissions || [];
      const scripts = obj.content_scripts || [];

      if (perms.includes("tabs")) warnings.push("Read your browsing history");
      if (perms.includes("bookmarks")) warnings.push("Read and change your bookmarks");
      if (perms.includes("history")) warnings.push("Read and change your browsing history");
      if (perms.includes("declarativeNetRequest") || perms.includes("declarativeNetRequestWithHostAccess")) {
        warnings.push("Block content on any page you visit");
      }

      let allHosts = [...hosts];
      scripts.forEach(s => { if (s.matches) allHosts.push(...s.matches); });
      
      if (allHosts.length >= 4) {
        warnings.push("Read and change your data on a number of websites");
      } else if (allHosts.length > 0) {
        allHosts.forEach(h => warnings.push(`Read and change your data on ${h}`));
      }

      return warnings;
    } catch (e) {
      throw e;
    }
  }

  showDiff(otherSideResult) {
    this.warningList.innerHTML = '';
    this.summaryBadges.innerHTML = '';

    if (this.result === undefined) {
      this.outputTitle.textContent = 'Invalid JSON Input';
      const li = document.createElement('li');
      li.className = 'empty-warning';
      li.textContent = 'Fix JSON syntax errors in the editor to calculate permission warnings.';
      this.warningList.appendChild(li);
      return;
    }

    if (this.result.length === 0) {
      this.outputTitle.textContent = 'No Warning Permissions Required';
      const li = document.createElement('li');
      li.className = 'empty-warning';
      li.textContent = 'This manifest requests no permissions that trigger install/update warnings.';
      this.warningList.appendChild(li);
      return;
    }

    this.outputTitle.textContent = `${this.result.length} Warning Permission${this.result.length > 1 ? 's' : ''}`;

    let addedCount = 0;
    let removedCount = 0;
    let unchangedCount = 0;

    for (let warning of this.result) {
      const card = document.createElement('li');
      card.className = 'warning-card';

      const isDiffTarget = (this.id === 'right-sidebar'); // right pane represents target/new version
      const isPresentInOther = otherSideResult && otherSideResult.includes(warning);

      let statusTag = '';
      if (otherSideResult === undefined || isPresentInOther) {
        card.classList.add('card-unchanged');
        statusTag = 'Unchanged';
        unchangedCount++;
      } else if (isDiffTarget) {
        card.classList.add('card-added');
        statusTag = '⚠️ + New Risk';
        addedCount++;
      } else {
        card.classList.add('card-removed');
        statusTag = '✓ - Removed';
        removedCount++;
      }

      if (warning === MultipleHostWarning || warning === "Read and change your data on a number of websites") {
        card.classList.add('card-multi-host');
      }

      card.innerHTML = `
        <span class="card-status-badge">${statusTag}</span>
        <span class="warning-card-text">${escapeHtml(warning)}</span>
      `;
      this.warningList.appendChild(card);
    }

    // Render diff summary badges
    if (otherSideResult !== undefined) {
      if (addedCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'diff-tag tag-added';
        badge.textContent = `⚠️ +${addedCount} New Warning${addedCount > 1 ? 's' : ''}`;
        badge.title = "Added warning permissions present update risks to users";
        this.summaryBadges.appendChild(badge);
      }
      if (removedCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'diff-tag tag-removed';
        badge.textContent = `✓ -${removedCount} Removed`;
        badge.title = "Permissions removed - no install warning generated";
        this.summaryBadges.appendChild(badge);
      }
    }
  }
}

/**
 * Line-by-line Diff Engine for JSON Code View
 */
class JSONDiffEngine {
  static computeDiff(leftText, rightText) {
    const leftLines = leftText.split('\n');
    const rightLines = rightText.split('\n');
    
    // Simple LCS-based line diff algorithm
    const matrix = Array(leftLines.length + 1).fill(null).map(() => Array(rightLines.length + 1).fill(0));

    for (let i = 1; i <= leftLines.length; i++) {
      for (let j = 1; j <= rightLines.length; j++) {
        if (leftLines[i - 1] === rightLines[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
        } else {
          matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
        }
      }
    }

    let i = leftLines.length;
    let j = rightLines.length;
    const diff = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
        diff.unshift({ type: 'unchanged', leftNum: i, rightNum: j, text: leftLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
        diff.unshift({ type: 'added', leftNum: '', rightNum: j, text: rightLines[j - 1] });
        j--;
      } else if (i > 0 && (j === 0 || matrix[i][j - 1] < matrix[i - 1][j])) {
        diff.unshift({ type: 'removed', leftNum: i, rightNum: '', text: leftLines[i - 1] });
        i--;
      }
    }

    return diff;
  }

  static renderDiffView(leftText, rightText, container, statsPill) {
    const diff = JSONDiffEngine.computeDiff(leftText, rightText);
    
    let addedLines = 0;
    let removedLines = 0;
    let html = '<table class="diff-table"><tbody>';

    diff.forEach(row => {
      if (row.type === 'added') addedLines++;
      if (row.type === 'removed') removedLines++;

      const prefix = row.type === 'added' ? '+' : (row.type === 'removed' ? '-' : ' ');
      html += `
        <tr class="diff-line-row ${row.type}">
          <td class="diff-line-num">${row.leftNum}</td>
          <td class="diff-line-num">${row.rightNum}</td>
          <td class="diff-line-prefix">${prefix}</td>
          <td class="diff-line-text">${escapeHtml(row.text)}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    if (statsPill) {
      statsPill.textContent = `+${addedLines} / -${removedLines} lines modified`;
    }
  }
}

/**
 * Global App Manager
 */
class Manager {
  static init() {
    Manager.left = new PermissionTest("left-sidebar");
    Manager.right = new PermissionTest("right-sidebar");

    Manager.bindGlobalControls();
    Manager.initMultipleHostWarning();
    Manager.setupSyncScroll();
  }

  static showDiff() {
    Manager.left.showDiff(Manager.right.result);
    Manager.right.showDiff(Manager.left.result);

    // If diff view active, update text diff
    const diffContainer = document.getElementById('diff-content');
    const statsPill = document.getElementById('diff-stats');
    if (diffContainer && document.getElementById('diff-view').classList.contains('active')) {
      JSONDiffEngine.renderDiffView(
        Manager.left.editor.getValue(),
        Manager.right.editor.getValue(),
        diffContainer,
        statsPill
      );
    }
  }

  static bindGlobalControls() {
    // Mode Switcher Buttons
    const btnEditors = document.getElementById('view-mode-editor');
    const btnDiff = document.getElementById('view-mode-diff');
    const viewEditors = document.getElementById('editors-view');
    const viewDiff = document.getElementById('diff-view');

    btnEditors.addEventListener('click', () => {
      btnEditors.classList.add('active');
      btnDiff.classList.remove('active');
      viewEditors.classList.add('active');
      viewDiff.classList.remove('active');
    });

    btnDiff.addEventListener('click', () => {
      btnDiff.classList.add('active');
      btnEditors.classList.remove('active');
      viewDiff.classList.add('active');
      viewEditors.classList.remove('active');

      JSONDiffEngine.renderDiffView(
        Manager.left.editor.getValue(),
        Manager.right.editor.getValue(),
        document.getElementById('diff-content'),
        document.getElementById('diff-stats')
      );
    });

    // Swap Panes Action
    document.getElementById('action-swap').addEventListener('click', () => {
      const leftVal = Manager.left.editor.getValue();
      const rightVal = Manager.right.editor.getValue();
      Manager.left.editor.setValue(rightVal);
      Manager.right.editor.setValue(leftVal);
    });

    // Format Both Action
    document.getElementById('action-format-all').addEventListener('click', () => {
      Manager.left.editor.format();
      Manager.right.editor.format();
    });
  }

  static setupSyncScroll() {
    const toggleSync = document.getElementById('toggle-sync-scroll');
    const leftTextarea = Manager.left.editor.textarea;
    const rightTextarea = Manager.right.editor.textarea;

    let isSyncingLeft = false;
    let isSyncingRight = false;

    leftTextarea.addEventListener('scroll', () => {
      if (!toggleSync.checked || isSyncingLeft) return;
      isSyncingRight = true;
      rightTextarea.scrollTop = leftTextarea.scrollTop;
      rightTextarea.scrollLeft = leftTextarea.scrollLeft;
      setTimeout(() => { isSyncingRight = false; }, 50);
    });

    rightTextarea.addEventListener('scroll', () => {
      if (!toggleSync.checked || isSyncingRight) return;
      isSyncingLeft = true;
      leftTextarea.scrollTop = rightTextarea.scrollTop;
      leftTextarea.scrollLeft = rightTextarea.scrollLeft;
      setTimeout(() => { isSyncingLeft = false; }, 50);
    });
  }

  static async initMultipleHostWarning() {
    const manifest = {
      name: "Host Warning Test",
      version: "1.0.0",
      manifest_version: 3,
      host_permissions: [
        "https://a.com/*",
        "https://b.com/*",
        "https://c.com/*",
        "https://d.com/*",
        "https://e.com/*"
      ]
    };

    if (typeof chrome !== 'undefined' && chrome.management && chrome.management.getPermissionWarningsByManifest) {
      try {
        const res = await chrome.management.getPermissionWarningsByManifest(JSON.stringify(manifest));
        if (res && res.length > 0) {
          MultipleHostWarning = res[0];
        }
      } catch(e) {}
    } else {
      MultipleHostWarning = "Read and change your data on a number of websites";
    }
  }
}

/**
 * Help Modal Dialog Controller
 */
class Help {
  static init() {
    Help.dialog = document.getElementById('help-dialog');
    document.getElementById('help-open').addEventListener('click', Help.show);
    document.getElementById('help-close').addEventListener('click', Help.close);
  }

  static show(e) {
    if (e) e.preventDefault();
    Help.dialog.showModal();
  }

  static close(e) {
    if (e) e.preventDefault();
    Help.dialog.close();
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  Manager.init();
  Help.init();
});