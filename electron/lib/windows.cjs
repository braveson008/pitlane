// One window per project, focused rather than duplicated, and reopened at the next launch.
function createWindowManager({ create, store }) {
  const open = new Map();
  let picker = null;
  let quitting = false;

  const record = () => { if (!quitting) store.set([...open.keys()]); };

  function openProject(id, { from } = {}) {
    // The picker has done its job once it opens a project; left open, it hides behind the project and catches ⌘N.
    if (from && from === picker) from.close();
    const existing = open.get(id);
    if (existing) {
      existing.focus();
      return existing;
    }
    const window = create(id);
    open.set(id, window);
    window.on("closed", () => {
      // The window may show another project by now than the one it was made for.
      for (const [shown, each] of open) if (each === window) open.delete(shown);
      record();
    });
    record();
    return window;
  }

  /** Shows another project in this window, or brings forward the window that already shows it. */
  function switchTo(window, id) {
    const existing = open.get(id);
    if (existing) {
      if (existing !== window) existing.focus();
      return { window: existing, moved: false };
    }
    for (const [shown, each] of open) if (each === window) open.delete(shown);
    open.set(id, window);
    record();
    return { window, moved: true };
  }

  function openPicker() {
    if (picker) {
      picker.focus();
      return picker;
    }
    picker = create(null);
    picker.on("closed", () => { picker = null; });
    return picker;
  }

  return {
    openProject,
    openPicker,
    switchTo,
    restore() {
      const ids = store.get();
      if (!ids.length) return void openPicker();
      for (const id of ids) openProject(id);
    },
    openIds: () => [...open.keys()],
    windowFor: (id) => open.get(id),
    quitting() { quitting = true; },
  };
}

module.exports = { createWindowManager };
