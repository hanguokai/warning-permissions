const TabSize = 2;// insert TabSize spaces for Tab

// debounce for user input
const delayExec = (function () {
  var timer = {};
  return function (callback, ms, type) {
    clearTimeout(timer[type] ? timer[type] : 0);
    timer[type] = setTimeout(callback, ms);
  };
})();

class PermissionTest {
  constructor(containerId) {
    this.id = containerId;
    let clone = document.importNode(document.getElementById("workspace").content, true);
    this.init(clone);
    document.getElementById(containerId).appendChild(clone);
  }

  init(clone) {
    this.textarea = clone.querySelector('textarea');
    this.textarea.addEventListener('input', e => delayExec(this.updateByTextarea.bind(this), 500, this.id + "-textarea"));
    this.textarea.addEventListener('keydown', PermissionTest.handleEdit);
    this.setExampleManifest();

    this.outputTitle = clone.querySelector('.output-title');
    this.output = clone.querySelector('.output');
  }

  setExampleManifest() {
    const manifest = {
      name: "My Extension",
      version: "1.0.0",
      manifest_version: 3,
      permissions: [],
      host_permissions: []
    };
    this.textarea.value = JSON.stringify(manifest, null, TabSize);
  }

  static handleEdit(e) {
    if (e.key == 'Tab') { // insert N spaces for Tab key
      e.preventDefault();
      document.execCommand('insertText', false, ' '.repeat(TabSize));
    }
  }

  updateByTextarea() {
    this.updateOutput(this.textarea.value);
  }

  async updateOutput(manifestStr) {
    try {
      let result = await chrome.management.getPermissionWarningsByManifest(manifestStr);
      result.sort();
      
      const count = result.length;
      if (count == 0) {
        this.outputTitle.textContent = 'No warning permission';
      } else {
        this.outputTitle.textContent = `${count} warning permission${count > 1 ? 's' : ''}`;
      }

      this.output.innerHTML = '';
      for (let warning of result) {
        let li = document.createElement('li');
        li.textContent = warning;
        this.output.appendChild(li);
      }

      this.outputTitle.classList.remove("error");
    } catch (e) {
      this.outputTitle.classList.add("error");
      this.outputTitle.textContent = 'Input Error: ' + e.message;
      this.output.innerHTML = '';
    }
  }
}

function init() {
  let left = new PermissionTest("left-sidebar");
  let right = new PermissionTest("right-sidebar");
}
init();