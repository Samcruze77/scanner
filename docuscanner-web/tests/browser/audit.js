// Paste/eval in the browser console (or via the test harness) to audit the current
// page at a phone width: horizontal overflow, touch targets under 44px, ad slots.
window.__audit = () => {
  const vw = innerWidth;
  const overflow = { docScrollW: document.documentElement.scrollWidth, vw, hasOverflow: document.documentElement.scrollWidth > vw + 1 };
  const wide = [...document.querySelectorAll('body *')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed'; })
    .slice(0, 5)
    .map((el) => el.tagName + '.' + (el.className || '').toString().slice(0, 40) + ' right=' + Math.round(el.getBoundingClientRect().right));
  const small = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[role=tab],[role=application]')]
    .filter((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') return false;
      if (el.classList.contains('sr-only') || el.type === 'file' || el.getAttribute('role') === 'application') return false;
      return r.height < 43.5 || r.width < 43.5;
    })
    .map((el) => { const r = el.getBoundingClientRect(); return (el.getAttribute('aria-label') || el.textContent.trim() || el.tagName).slice(0, 28) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); });
  const ads = [...document.querySelectorAll('[data-ad-placement]')].map((a) => { const r = a.getBoundingClientRect(); return a.dataset.adPlacement + ':' + Math.round(r.width) + 'x' + Math.round(r.height) + '@y' + Math.round(r.top + scrollY); });
  return { path: location.pathname, overflow, wide, small, ads };
};
