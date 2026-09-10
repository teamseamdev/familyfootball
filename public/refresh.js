function getIndicator() {
  let element = document.querySelector('#pull-refresh-indicator');
  if (!element) {
    element = document.createElement('div');
    element.id = 'pull-refresh-indicator';
    element.className = 'pull-refresh-indicator';
    element.setAttribute('aria-live', 'polite');
    element.textContent = 'Pull to refresh';
    document.body.prepend(element);
  }
  return element;
}

export function enablePullToRefresh(refresh) {
  const element = getIndicator();
  let startY = 0;
  let distance = 0;
  let tracking = false;
  let refreshing = false;

  document.addEventListener('touchstart', event => {
    if (window.scrollY <= 0 && event.touches.length === 1) {
      startY = event.touches[0].clientY;
      distance = 0;
      tracking = true;
    }
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (!tracking || refreshing) return;
    distance = Math.max(0, event.touches[0].clientY - startY);
    if (!distance) return;
    event.preventDefault();
    element.style.transform = `translate(-50%, ${Math.min(distance * .45, 64)}px)`;
    element.classList.add('visible');
    element.textContent = distance >= 90 ? 'Release to refresh' : 'Pull to refresh';
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (!tracking || refreshing) return;
    tracking = false;
    if (distance < 90) {
      element.classList.remove('visible');
      element.style.transform = '';
      return;
    }
    refreshing = true;
    element.textContent = 'Refreshing…';
    element.style.transform = 'translate(-50%, 52px)';
    try {
      await refresh();
      element.textContent = 'Updated';
    } catch {
      element.textContent = 'Could not refresh';
    } finally {
      setTimeout(() => {
        element.classList.remove('visible');
        element.style.transform = '';
        refreshing = false;
      }, 700);
    }
  }, { passive: true });
}

export function startAutoRefresh(refresh, interval = 60_000) {
  let running = false;
  return setInterval(async () => {
    if (document.visibilityState !== 'visible' || running) return;
    running = true;
    try { await refresh(); } finally { running = false; }
  }, interval);
}
