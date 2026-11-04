(() => {
  'use strict';
  let toastTimer;
  window.whaleToast = message => {
    if (window.WhaleCollapse?.collapsed || window.WhaleCollapse?.busy) return;
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  };
  window.addEventListener('whale-collapse-changed', event => {
    if (event.detail.collapsed) {
      clearTimeout(toastTimer);
      document.getElementById('toast').hidden = true;
    }
  });
})();
