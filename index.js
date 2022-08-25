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
      this.result = result;
      
      this.outputTitle.textContent = result.length == 0 ? 'No warning permission' : 'Warning permissions';

      this.output.innerHTML = '';
      for (let warning of result) {
        let li = document.createElement('li');
        li.textContent = warning;
        this.output.appendChild(li);
      }

      this.outputTitle.classList.remove("error");
    } catch (e) {
      this.result = undefined;
      this.outputTitle.classList.add("error");
      this.outputTitle.textContent = 'Input Error: ' + e.message;
      this.output.innerHTML = '';
    }
    Manager.showDiff();
  }

  showDiff(otherSideResult) {
    if(this.result === undefined) {
      return;
    }

    if(otherSideResult === undefined) {
      // clear all warning
      for (let li of this.output.children) {
        li.classList.remove('warning');
      }
      return;
    }

    for (let i = 0; i < this.result.length; i++) {
      if (!otherSideResult.includes(this.result[i])) {
        this.output.children[i].classList.add('warning');
      } else {
        this.output.children[i].classList.remove('warning');
      }
    }
  }
}

class Manager {
  static init() {
    Manager.left = new PermissionTest("left-sidebar");
    Manager.right = new PermissionTest("right-sidebar");
  }

  static showDiff() {
    Manager.left.showDiff(Manager.right.result);
    Manager.right.showDiff(Manager.left.result);
  }
}

Manager.init();