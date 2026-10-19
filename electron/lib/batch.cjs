/** Collects output for one frame and sends it once, so a burst of PTY chunks is not a burst of IPC messages. */
function createBatcher(send, ms = 16) {
  let pending = "";
  let timer = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const data = pending;
    pending = "";
    send(data);
  };
  return {
    push(data) {
      pending += data;
      timer ??= setTimeout(flush, ms);
    },
    stop() {
      clearTimeout(timer);
      flush();
    },
  };
}

module.exports = { createBatcher };
