import { useEffect } from 'react';

// Warns the operator before they lose unsaved form work. Two vectors:
//
//   1. Hard navigation (tab close, refresh, typing a new URL, external
//      links) — the browser's native beforeunload prompt.
//   2. Soft in-app navigation (clicking a <Link> / breadcrumb / nav item) —
//      a capture-phase click interceptor that confirm()s before letting the
//      App Router navigate, and cancels the click if the operator stays.
//
// Not covered: the browser BACK button on a soft navigation (App Router has
// no abortable route-change event). beforeunload still catches back when it
// triggers a full document unload. Acceptable trade-off for a lightweight
// guard — the destructive close/refresh case is fully covered.
//
// Submit flows are unaffected: server actions redirect programmatically (not
// via an <a> click), so the interceptor never fires on a successful save.
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy assignment required by some browsers to show the prompt.
      e.returnValue = '';
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      // Let modifier / non-primary clicks through (open-in-new-tab, etc.).
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (anchor.hasAttribute('download')) return;
      const linkTarget = anchor.getAttribute('target');
      if (linkTarget && linkTarget !== '' && linkTarget !== '_self') return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Only guard same-origin navigations that actually change the page.
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }

      const stay = !window.confirm(
        'You have unsaved changes. Leave this page and lose them?',
      );
      if (stay) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture phase so we run before the App Router's own click handler.
    document.addEventListener('click', onClick, true);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [isDirty]);
}
