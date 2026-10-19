// One window per project, focused rather than duplicated, and reopened at the next launch.
function createWindowManager({ create, store }) {
  const open = new Map();
  let picker = null;
  let quitting = false;

  const record = () => { if (!quitting) store.set([...open.keys()]); };

  function openProject(id) {
    const existing = open.get(id);
    if (existing) {
      existing.focus();
      return existing;
    }
    const window = create(id);
    open.set(id, window);
    window.on("closed", () => {
      if (open.get(id) === window) open.delete(id);
      record();
    });
    record();
    return window;
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
