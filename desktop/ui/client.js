(() => {
  'use strict';
  let toastTimer;
  window.whaleToast = message => {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
  };
})();
